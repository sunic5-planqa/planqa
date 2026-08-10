import asyncio
import hashlib
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
from sunnic_backend.qa_engine.review_agent.llm.anthropic import AnthropicClient
from sunnic_backend.qa_engine.review_agent.pipeline import ReviewResult
from sunnic_backend.qa_engine.review_agent.planqa_schemas.rulebook import (
    RuleBook,
    parse_rulebook,
)
from sunnic_backend.qa_engine.review_agent.planqa_schemas.schema import (
    Issue as ReviewIssue,
)
from sunnic_backend.qa_engine.review_agent.structures.bundled_screen_hybrid import (
    review_document,
)
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
#   LG/LF/GA: 두 위치 간 관계 오류라 range 프레임 — review-agent가 related_location을 채워주면
#     (요청 이슈 sunic5-planqa/planqa-agent#4, 2026-08-10 재벤더링으로 반영됨) range, 모델이
#     특정 못 해 비어 있으면 object로 안전하게 폴백한다.
_RANGE_CATEGORIES = frozenset({"LG", "LF", "GA"})
_INSERT_RANGE_CATEGORIES = frozenset({"MI"})


def _frame_type(category: str, related_location: str | None) -> FrameType:
    if category in _INSERT_RANGE_CATEGORIES:
        return FrameType.INSERT_RANGE
    if category in _RANGE_CATEGORIES and related_location:
        return FrameType.RANGE
    return FrameType.OBJECT


# SCREEN 02 groups categories by review pass. bundled_screen_hybrid.review_document()
# (2026-08-10 재벤더링) only runs two passes now — Paragraph (most categories) and Document
# (relational categories that need whole-document visibility, same set as _RANGE_CATEGORIES
# above) — replacing the old 4-tier structure (Document/Logical Unit/Paragraph/Sentence),
# where Logical Unit and Sentence aren't queried by this structure at all anymore. Reusing
# _RANGE_CATEGORIES here (rather than a second frozenset) keeps this in lockstep with
# _frame_type's own notion of "relational" automatically.
_PROGRESS_GROUPS: tuple[tuple[str, str], ...] = (
    ("paragraph", "Paragraph"),
    ("document", "Document"),
)


def _category_label_by_prefix(rulebook: RuleBook) -> dict[str, str]:
    labels: dict[str, str] = {}
    for rule in rulebook.rules.values():
        labels.setdefault(rule.category, _korean_label(rule.category_label))
    return labels


def _build_tier_groups(rulebook: RuleBook) -> list[tuple[str, str, list[tuple[str, str]]]]:
    # Static per-rulebook structure (doesn't change per job): (group_key, group_label,
    # [(category_prefix, category_label), ...]) for every pass that actually has categories.
    labels = _category_label_by_prefix(rulebook)
    by_group: dict[str, list[tuple[str, str]]] = {"paragraph": [], "document": []}
    for prefix, label in labels.items():
        by_group["document" if prefix in _RANGE_CATEGORIES else "paragraph"].append((prefix, label))
    return [(key, label, by_group[key]) for key, label in _PROGRESS_GROUPS if by_group[key]]


def _categories_for_progress(rulebook: RuleBook, progress: int) -> tuple[list[ProgressCategoryOut], str | None]:
    # No per-category completion signal exists (see docs/adr/0001-...), so this is still a
    # cosmetic checklist derived from the same fake progress % the ticker computes. But
    # bundled_screen_hybrid.review_document() (2026-08-10 재벤더링) runs its two passes
    # genuinely *sequentially* — Paragraph, then Document — unlike the old category_screen
    # structure's 4 concurrent tiers, which is why that version made every group advance in
    # lockstep. Now that execution really is one-group-then-the-next, fill each group's own
    # fraction of the overall fake progress in turn instead, so the checklist tracks the
    # real pass order (Paragraph fills to 100% before Document starts moving at all).
    groups = _build_tier_groups(rulebook)
    if not groups:
        return [], None

    fraction = min(max(progress / 100, 0.0), 1.0)
    per_group_fraction = 1.0 / len(groups)

    out: list[ProgressCategoryOut] = []
    current_category: str | None = None
    for group_index, (group_key, group_label, items) in enumerate(groups):
        group_start = group_index * per_group_fraction
        group_fraction = min(max((fraction - group_start) / per_group_fraction, 0.0), 1.0)
        done_count = len(items) if progress >= 100 else int(group_fraction * len(items))

        item_out: list[CategoryItemOut] = []
        for idx, (item_key, item_label) in enumerate(items):
            if idx < done_count:
                status = "done"
            elif idx == done_count and done_count < len(items):
                status = "in_progress"
                if current_category is None:
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
    # review_agent's AnthropicClient is a blocking/sync client (retry backoff uses time.sleep)
    # — this whole call runs inside asyncio.to_thread so it never blocks the event loop.
    #
    # bundled_screen_hybrid.review_document() (2026-08-10 재벤더링) calls screen_llm/confirm_llm
    # directly and sequentially (Paragraph pass, then Document pass) — unlike the old
    # category_screen structure, nothing here runs concurrently, so LLMClient.clone() is never
    # called and the _ScopedClient workaround built for it (see docs/adr/0001-...) is gone —
    # explicit api_key= is threaded straight through the constructor, same as before.
    # 1차 스크리닝(저비용, over-flag 의도) = Haiku, 2차 정밀검증(고비용, 정밀) = Sonnet.
    screen_llm = AnthropicClient(model=settings.sunnic_haiku_model, api_key=settings.anthropic_api_key)
    confirm_llm = AnthropicClient(model=settings.sunnic_sonnet_model, api_key=settings.anthropic_api_key)
    return review_document(doc_id, document_text, rulebook, screen_llm, confirm_llm)


# 이슈 목록을 "문서 본문 순서"로 보여주려면(SCREEN 02 "다음"/오버뷰가 왼쪽 원본을 위→아래로 훑도록)
# 각 이슈가 document_text 안 어디쯤인지가 필요하다. input_text로 못 찾는 경우(정보 누락=MI 이슈는
# 애초에 원문에 없는 걸 지적하니 input_text가 비어있는 게 정상)엔 그 이슈가 속한 위계(location)의
# 제목이라도 찾아 대략적인 위치로 쓴다 — 그마저 못 찾으면 맨 앞(0)이 아니라 맨 뒤로 보낸다. 맨
# 앞으로 잘못 보내면 실제로는 문서 후반부 이슈인데 항상 첫 번째로 나와버려서 순서 왜곡이 더 커진다.
def _issue_start(document_text: str, input_text: str, location: str) -> int:
    if input_text:
        start = document_text.find(input_text)
        if start != -1:
            return start
    heading = location.rsplit(">", 1)[-1].strip()
    if heading:
        idx = document_text.find(heading)
        if idx != -1:
            return idx
    return len(document_text)


def _to_issue_record(job_id: str, document_text: str, rulebook: RuleBook, issue: ReviewIssue) -> IssueRecord:
    rule = rulebook.rule(issue.rule_id)
    criteria = _korean_label(rule.category_label) if rule else issue.rule_id
    related_location = issue.related_location
    frame_type = _frame_type(rule.category, related_location) if rule else FrameType.OBJECT
    input_text = issue.original_text or ""
    start = _issue_start(document_text, input_text, issue.location)
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


# 4개 tier가 순차 실행이던 시절(예전 벤더링) 기준으로 잡았던 상수(45s)가 그대로 남아 있었다 —
# 2026-08-10 재벤더링 이후로는 4개가 ThreadPoolExecutor로 동시에 돌아서 실제로 훨씬 빨리
# 끝나는데(Claude Haiku→Sonnet 조합 실측 66.1초, DOC-001), 곡선은 여전히 "45초짜리 작업"
# 기준으로 늘어져서 체감상 진행바가 계속 느려 보였다. 실측치 기준으로 t=완료 시점 즈음엔 90%
# 근처까지 거의 다 차 있도록(더 이상 "끝났는데도 한참 밑에 머물러 있는" 느낌이 안 나도록) 시간
# 상수를 다시 잡음 — 20s면 t=66s에 86%까지 올라온다(예전 45s 기준으로는 69%에 그쳤음).
_ESTIMATED_DURATION_SECONDS = 20.0


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


# document_text(추출된 문서 전문) 기준으로 리뷰 결과를 캐싱한다 — 같은 컨플루언스 페이지를 반복
# 테스트할 때마다 실제 Claude API를 새로 호출하면 시간(수십 초)과 비용이 매번 든다. 프로세스
# 메모리에만 두고(재시작하면 비워짐) 이 서비스의 다른 저장소(store)와 같은 "인메모리" 정책을 따름 —
# 코드/프롬프트/룰북을 고치면 어차피 서버를 재시작하니 그 시점에 자연스럽게 캐시도 무효화된다.
_review_cache: dict[str, ReviewResult] = {}


def _document_cache_key(document_text: str) -> str:
    return hashlib.sha256(document_text.encode("utf-8")).hexdigest()


async def _execute_qa_job(job_id: str, document_id: str, document_text: str) -> None:
    job = await store.get_qa_job(job_id)
    if job is None:
        return
    rulebook = _load_rulebook()
    cache_key = _document_cache_key(document_text)
    cached = _review_cache.get(cache_key)
    ticker: asyncio.Task[None] | None = None
    try:
        if cached is not None:
            result = cached
        else:
            ticker = asyncio.create_task(_tick_progress(job_id, job.started_at))
            result = await asyncio.to_thread(_run_review_sync, document_id, document_text, rulebook)
            _review_cache[cache_key] = result
        for issue in result.issues:
            await store.save_issue(_to_issue_record(job_id, document_text, rulebook, issue))
        await store.save_qa_job(job.model_copy(update={"status": QAJobStatus.DONE, "progress": 100}))
    except Exception:  # noqa: BLE001 - a failed job must still resolve to a terminal status
        await store.save_qa_job(job.model_copy(update={"status": QAJobStatus.FAILED, "progress": 100}))
    finally:
        if ticker is not None:
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
    # 저장 순서(리뷰 파이프라인이 위계별 tier를 병렬로 처리하며 붙인 순서)가 아니라 문서 본문에서
    # 실제로 나타나는 순서로 내려줘야, SCREEN 02의 "다음"/오버뷰가 왼쪽 원본 문서를 위→아래로 훑듯
    # 움직인다 — 안 그러면 tier가 섞여서 클릭할 때마다 문서 위아래로 왔다갔다하게 된다.
    issues = sorted(issues, key=lambda issue: issue.start)
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
