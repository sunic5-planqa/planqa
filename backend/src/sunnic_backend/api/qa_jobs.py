import asyncio
import uuid
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

from sunnic_backend.config import settings
from sunnic_backend.models.issue import Issue as IssueRecord
from sunnic_backend.models.issue import IssueStatus
from sunnic_backend.models.qa_job import QAJob, QAJobStatus
from sunnic_backend.qa_engine.review_agent.llm.gemini import DEFAULT_MODEL, GeminiClient
from sunnic_backend.qa_engine.review_agent.models import gemini_lite
from sunnic_backend.qa_engine.review_agent.pipeline import ReviewResult, review_document
from sunnic_backend.qa_engine.review_agent.rulebook import RuleBook, parse_rulebook
from sunnic_backend.qa_engine.review_agent.schema import Issue as ReviewIssue
from sunnic_backend.storage.store import store

router = APIRouter(tags=["qa-jobs"])

_RULEBOOK_PATH = Path(__file__).resolve().parent.parent / "qa_engine" / "review_agent" / "data" / "rulebook_v1.0.md"
_rulebook: RuleBook | None = None


def _load_rulebook() -> RuleBook:
    # Parsed once per process — the rulebook file doesn't change at runtime, and parsing it
    # per job would be pure waste on every QA run.
    global _rulebook
    if _rulebook is None:
        _rulebook = parse_rulebook(_RULEBOOK_PATH)
    return _rulebook


class CreateQAJobResponse(BaseModel):
    job_id: str


class QAJobStatusResponse(BaseModel):
    status: str
    progress: int
    current_category: str | None
    elapsed_seconds: float


class IssueResponse(BaseModel):
    id: str
    location: str
    input_text: str
    criteria: str
    reason: str
    suggestion: str


def _run_review_sync(doc_id: str, document_text: str, rulebook: RuleBook) -> ReviewResult:
    # review_agent's GeminiClient is a blocking/sync client (retry backoff uses time.sleep) —
    # this whole call runs inside asyncio.to_thread so it never blocks the event loop.
    screen_llm = GeminiClient(model=settings.qa_screen_model or DEFAULT_MODEL, api_keys=settings.gemini_api_keys)
    confirm_llm = GeminiClient(model=settings.qa_confirm_model or DEFAULT_MODEL, api_keys=settings.gemini_api_keys)
    return review_document(doc_id, document_text, rulebook, screen_llm, confirm_llm, gemini_lite)


def _to_issue_record(job_id: str, document_text: str, rulebook: RuleBook, issue: ReviewIssue) -> IssueRecord:
    rule = rulebook.rule(issue.rule_id)
    criteria = rule.category_label if rule else issue.rule_id
    input_text = issue.original_text or ""
    start = document_text.find(input_text) if input_text else -1
    start = max(start, 0)
    return IssueRecord(
        id=str(uuid.uuid4()),
        job_id=job_id,
        location=issue.location,
        input_text=input_text,
        criteria=criteria,
        reason=issue.rationale or issue.description,
        suggestion=issue.fix_direction or "",
        status=IssueStatus.PENDING,
        edited_text=None,
        start=start,
        end=start + len(input_text),
    )


async def _execute_qa_job(job_id: str, document_id: str, document_text: str) -> None:
    job = await store.get_qa_job(job_id)
    if job is None:
        return
    rulebook = _load_rulebook()
    try:
        result = await asyncio.to_thread(_run_review_sync, document_id, document_text, rulebook)
        for issue in result.issues:
            await store.save_issue(_to_issue_record(job_id, document_text, rulebook, issue))
        await store.save_qa_job(job.model_copy(update={"status": QAJobStatus.DONE, "progress": 100}))
    except Exception:  # noqa: BLE001 - a failed job must still resolve to a terminal status
        await store.save_qa_job(job.model_copy(update={"status": QAJobStatus.FAILED, "progress": 100}))


@router.post("/documents/{document_id}/qa-jobs", response_model=CreateQAJobResponse)
async def create_qa_job(document_id: str, background_tasks: BackgroundTasks) -> CreateQAJobResponse:
    document = await store.get_document(document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="document not found")

    job = QAJob(
        id=str(uuid.uuid4()),
        document_id=document_id,
        status=QAJobStatus.RUNNING,
        progress=0,
        current_category=None,
        started_at=datetime.now(UTC),
    )
    await store.save_qa_job(job)
    background_tasks.add_task(_execute_qa_job, job.id, document_id, document.raw_text)
    return CreateQAJobResponse(job_id=job.id)


@router.get("/qa-jobs/{job_id}/status", response_model=QAJobStatusResponse)
async def get_qa_job_status(job_id: str) -> QAJobStatusResponse:
    job = await store.get_qa_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="qa job not found")
    elapsed = (datetime.now(UTC) - job.started_at).total_seconds()
    return QAJobStatusResponse(
        status=job.status.value, progress=job.progress, current_category=job.current_category, elapsed_seconds=elapsed
    )


@router.get("/qa-jobs/{job_id}/issues", response_model=list[IssueResponse])
async def list_qa_job_issues(job_id: str) -> list[IssueResponse]:
    job = await store.get_qa_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="qa job not found")
    issues = await store.list_issues_for_job(job_id)
    return [
        IssueResponse(
            id=issue.id,
            location=issue.location,
            input_text=issue.input_text,
            criteria=issue.criteria,
            reason=issue.reason,
            suggestion=issue.suggestion,
        )
        for issue in issues
    ]
