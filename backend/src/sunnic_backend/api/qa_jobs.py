import asyncio
import math
import re
import uuid
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

from sunnic_backend.config import settings
from sunnic_backend.models.issue import FrameType, IssueStatus
from sunnic_backend.models.issue import Issue as IssueRecord
from sunnic_backend.models.qa_job import QAJob, QAJobStatus
from sunnic_backend.qa_engine.review_agent.llm.gemini import DEFAULT_MODEL, GeminiClient
from sunnic_backend.qa_engine.review_agent.models import gemini_lite
from sunnic_backend.qa_engine.review_agent.pipeline import ReviewResult, review_document
from sunnic_backend.qa_engine.review_agent.rulebook import RuleBook, parse_rulebook
from sunnic_backend.qa_engine.review_agent.schema import Issue as ReviewIssue
from sunnic_backend.qa_engine.review_agent.schema import Level
from sunnic_backend.qa_engine.review_agent.tiers import TIER_CATEGORIES
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


class CategoryItemOut(BaseModel):
    key: str
    label: str
    status: str


class ProgressCategoryOut(BaseModel):
    key: str
    label: str
    items: list[CategoryItemOut]


# rulebook_v1.0.md's category headings are "<Korean phrase> <English Title Case phrase>"
# (e.g. "용어 및 단어의 일관성 Terminology Consistency") — the UI only wants the Korean part.
_ENGLISH_SUFFIX_RE = re.compile(r"^(.*?\S)\s+[A-Za-z].*$")


def _korean_label(category_label: str) -> str:
    match = _ENGLISH_SUFFIX_RE.match(category_label)
    return match.group(1) if match else category_label


# 프레임(문서 위 하이라이트 박스) 유형은 QA 기준의 카테고리만으로 정해진다 — 상세 근거는
# docs/progress.md 2026-08-09 항목, 원본 설계는 "Ver.2 - Edit 행위별 프레임 유형 구분" 참고.
#   TC/TM/AE/RD: Replace/Delete만 허용되는 룰이라 항상 단일 위치 object 프레임.
#   MI: Insert만 허용 — 정보가 없는 자리를 포함하는 최소 상위 위계를 감싸는 insert_range.
#   LG/LF/GA: 두 위치 간 관계 오류라 원래 range 프레임이 맞지만, 그러려면 두 번째 위치
#     (related_location)가 있어야 한다 — 아직 review-agent의 Issue 스키마에 그 필드가 없어서
#     (요청 이슈: sunic5-planqa/planqa-agent#4) 값이 오기 전까지는 object로 안전하게 폴백한다.
_RANGE_CATEGORIES = frozenset({"LG", "LF", "GA"})
_INSERT_RANGE_CATEGORIES = frozenset({"MI"})


def _frame_type(category: str, related_location: str | None) -> FrameType:
    if category in _INSERT_RANGE_CATEGORIES:
        return FrameType.INSERT_RANGE
    if category in _RANGE_CATEGORIES and related_location:
        return FrameType.RANGE
    return FrameType.OBJECT


# SCREEN 02 groups categories by review tier — these four map 1:1 to tiers.TIER_ORDER.
_TIER_GROUPS: tuple[tuple[Level, str, str], ...] = (
    (Level.DOCUMENT, "documents", "Documents"),
    (Level.LOGICAL_UNIT, "logical_chapter", "Logical Chapter"),
    (Level.PARAGRAPH, "detailed_chapter", "Detailed Chapter"),
    (Level.SENTENCE, "sentence", "Sentence"),
)


def _category_label_by_prefix(rulebook: RuleBook) -> dict[str, str]:
    labels: dict[str, str] = {}
    for rule in rulebook.rules.values():
        labels.setdefault(rule.category, _korean_label(rule.category_label))
    return labels


def _build_tier_groups(rulebook: RuleBook) -> list[tuple[str, str, list[tuple[str, str]]]]:
    # Static per-rulebook structure (doesn't change per job): (group_key, group_label,
    # [(category_prefix, category_label), ...]) for every tier that actually has categories.
    labels = _category_label_by_prefix(rulebook)
    groups = []
    for level, key, label in _TIER_GROUPS:
        items = [(prefix, labels[prefix]) for prefix in TIER_CATEGORIES.get(level, ()) if prefix in labels]
        if items:
            groups.append((key, label, items))
    return groups


def _categories_for_progress(rulebook: RuleBook, progress: int) -> tuple[list[ProgressCategoryOut], str | None]:
    # No per-category completion signal exists (see docs/adr/0001-...) — this derives a
    # plausible-looking checklist from the same fake progress % the ticker already computes,
    # walking through tiers/categories in order as progress advances. Purely cosmetic; the
    # real per-tier result only ever lands atomically when review_document() returns.
    groups = _build_tier_groups(rulebook)
    if not groups:
        return [], None

    band = 90 / len(groups)
    tier_index = len(groups) - 1 if progress >= 90 else min(len(groups) - 1, int(progress // band))

    out: list[ProgressCategoryOut] = []
    current_category: str | None = None
    for i, (group_key, group_label, items) in enumerate(groups):
        if i < tier_index or progress >= 90:
            done_count = len(items)
        elif i == tier_index:
            within = min(max((progress - i * band) / band, 0.0), 1.0) if band > 0 else 1.0
            done_count = int(within * len(items))
        else:
            done_count = 0

        item_out: list[CategoryItemOut] = []
        for idx, (item_key, item_label) in enumerate(items):
            if idx < done_count:
                status = "done"
            elif idx == done_count and i == tier_index and done_count < len(items):
                status = "in_progress"
                current_category = item_label
            else:
                status = "pending"
            item_out.append(CategoryItemOut(key=f"{group_key}:{item_key}", label=item_label, status=status))
        out.append(ProgressCategoryOut(key=group_key, label=group_label, items=item_out))
    return out, current_category


class CreateQAJobResponse(BaseModel):
    job_id: str


class QAJobStatusResponse(BaseModel):
    status: str
    progress: int
    current_category: str | None
    elapsed_seconds: float
    categories: list[ProgressCategoryOut] | None = None


class IssueResponse(BaseModel):
    id: str
    location: str
    input_text: str
    criteria: str
    reason: str
    suggestion: str
    frame_type: FrameType
    related_location: str | None


def _run_review_sync(doc_id: str, document_text: str, rulebook: RuleBook) -> ReviewResult:
    # review_agent's GeminiClient is a blocking/sync client (retry backoff uses time.sleep) —
    # this whole call runs inside asyncio.to_thread so it never blocks the event loop.
    screen_llm = GeminiClient(model=settings.qa_screen_model or DEFAULT_MODEL, api_keys=settings.gemini_api_keys)
    confirm_llm = GeminiClient(model=settings.qa_confirm_model or DEFAULT_MODEL, api_keys=settings.gemini_api_keys)
    return review_document(doc_id, document_text, rulebook, screen_llm, confirm_llm, gemini_lite)


def _to_issue_record(job_id: str, document_text: str, rulebook: RuleBook, issue: ReviewIssue) -> IssueRecord:
    rule = rulebook.rule(issue.rule_id)
    criteria = _korean_label(rule.category_label) if rule else issue.rule_id
    # getattr — 벤더링한 schema.py에 아직 related_location이 없어도(재벤더링 전) 에러 없이 None으로
    # 폴백, 필드가 생기면 코드 변경 없이 자동으로 채워진다.
    related_location: str | None = getattr(issue, "related_location", None)
    frame_type = _frame_type(rule.category, related_location) if rule else FrameType.OBJECT
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
        frame_type=frame_type,
        related_location=related_location,
    )


_ESTIMATED_DURATION_SECONDS = 45.0


async def _tick_progress(job_id: str, started_at: datetime) -> None:
    # review_document() has no per-tier progress hook (see docs/adr/0001-...), so this fakes
    # a smoothly-advancing bar instead of leaving it pinned at 0% for the whole run — it
    # asymptotically approaches 90% (never claims done before the real result lands) based on
    # elapsed time against a rough per-document duration estimate, then _execute_qa_job jumps
    # it straight to 100 once the pipeline actually returns.
    try:
        while True:
            await asyncio.sleep(1.5)
            job = await store.get_qa_job(job_id)
            if job is None or job.status != QAJobStatus.RUNNING:
                return
            elapsed = (datetime.now(UTC) - started_at).total_seconds()
            progress = min(90, int(90 * (1 - math.exp(-elapsed / _ESTIMATED_DURATION_SECONDS))))
            if progress > job.progress:
                await store.save_qa_job(job.model_copy(update={"progress": progress}))
    except asyncio.CancelledError:
        pass


async def _execute_qa_job(job_id: str, document_id: str, document_text: str) -> None:
    job = await store.get_qa_job(job_id)
    if job is None:
        return
    rulebook = _load_rulebook()
    ticker = asyncio.create_task(_tick_progress(job_id, job.started_at))
    try:
        result = await asyncio.to_thread(_run_review_sync, document_id, document_text, rulebook)
        for issue in result.issues:
            await store.save_issue(_to_issue_record(job_id, document_text, rulebook, issue))
        await store.save_qa_job(job.model_copy(update={"status": QAJobStatus.DONE, "progress": 100}))
    except Exception:  # noqa: BLE001 - a failed job must still resolve to a terminal status
        await store.save_qa_job(job.model_copy(update={"status": QAJobStatus.FAILED, "progress": 100}))
    finally:
        ticker.cancel()


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
    categories, current_category = _categories_for_progress(_load_rulebook(), job.progress)
    return QAJobStatusResponse(
        status=job.status.value,
        progress=job.progress,
        current_category=current_category,
        elapsed_seconds=elapsed,
        categories=categories,
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
            frame_type=issue.frame_type,
            related_location=issue.related_location,
        )
        for issue in issues
    ]
