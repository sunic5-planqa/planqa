import asyncio
import logging
import math
import re
import uuid
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

from sunnic_backend.config import settings
from sunnic_backend.models.issue import FrameType, IssueStatus
from sunnic_backend.models.issue import Issue as IssueRecord
from sunnic_backend.models.qa_job import QAJob, QAJobStatus
from sunnic_backend.qa_engine.review_agent.document import parse_document
from sunnic_backend.qa_engine.review_agent.llm.anthropic import AnthropicClient
from sunnic_backend.qa_engine.review_agent.llm.gemini import GeminiClient
from sunnic_backend.qa_engine.review_agent.pipeline import ReviewResult
from sunnic_backend.qa_engine.review_agent.planqa_schemas.rulebook import (
    RuleBook,
    parse_rulebook,
)
from sunnic_backend.qa_engine.review_agent.planqa_schemas.schema import (
    Issue as ReviewIssue,
)
from sunnic_backend.qa_engine.review_agent.planqa_schemas.schema import (
    Level,
)
from sunnic_backend.qa_engine.review_agent.structures.bundled_screen_hybrid import (
    review_document,
)
from sunnic_backend.qa_engine.review_agent.tiers import TIER_CATEGORIES
from sunnic_backend.qa_engine.team_rule_adapter import (
    TEAM_CATEGORY,
    TEAM_RULE_ID_PREFIX,
    merge_team_rules,
)
from sunnic_backend.storage.store import store

logger = logging.getLogger(__name__)

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


# SCREEN 02 groups categories by review 위계 (tier), not by API call — bundled_screen_hybrid.
# review_document() only ever *dispatches* two passes, Paragraph and Document (Level.LOGICAL_UNIT
# chunks are never sent to the model directly), but a Paragraph-tier finding can still be
# *promoted* to Level.LOGICAL_UNIT in the reported Issue via resolve_reported_level (confirm names
# a coarser "level" than the chunk it was given — see bundled_screen_hybrid.py's confirm prompt).
# So Logical Unit is a real reported outcome even without its own dispatch pass, and rulebook_v1.0.md
# §2's own tier table (tiers.TIER_CATEGORIES) lists it as covering every category — showing it as a
# third group here (using that same canonical mapping, not an ad-hoc frozenset) reflects that
# accurately. A category can legitimately appear in more than one group (e.g. "LG" is reviewable at
# Document, Logical Unit, and Paragraph tiers all at once per §2) — that's not a display bug.
#
# Still cosmetic progress (see docs/adr/0001-...): there's no per-category completion signal, so
# every group fills at the same fake elapsed-time fraction regardless of which categories are in it.
#
# Known imprecision: bundled_screen_hybrid also routes two *individual* rule_ids
# (tiers.ABSENCE_CHECK_RULE_IDS — LG-01, TC-02) into the Document pass regardless of their
# category, but this checklist only has per-*category* granularity — so the "TC" item still
# shows under Paragraph/Logical Unit as a whole (accurate for TC-01/03/04/05, technically early
# for the single rule TC-02) rather than splitting one category across groups. Not worth the
# added complexity for a cosmetic, already-fake progress signal.
_PROGRESS_GROUPS: tuple[tuple[str, str, Level], ...] = (
    ("document", "Document", Level.DOCUMENT),
    ("logical_unit", "Logical Unit", Level.LOGICAL_UNIT),
    ("paragraph", "Paragraph", Level.PARAGRAPH),
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
    groups: list[tuple[str, str, list[tuple[str, str]]]] = []
    for group_key, group_label, level in _PROGRESS_GROUPS:
        tier_categories = TIER_CATEGORIES.get(level, ())
        items = [(prefix, label) for prefix, label in labels.items() if prefix in tier_categories]
        if items:
            groups.append((group_key, group_label, items))
    return groups


def _categories_for_progress(rulebook: RuleBook, progress: int) -> tuple[list[ProgressCategoryOut], str | None]:
    # No per-category completion signal exists (see docs/adr/0001-...), so this is still a
    # cosmetic checklist derived from the same fake progress % the ticker computes. Briefly
    # (right after the bundled_screen_hybrid re-sync, before its own follow-up parallelization
    # landed upstream) the two passes ran strictly sequentially and this filled Paragraph to
    # 100% before Document moved at all — but review-agent's own "perf: run bundled_screen_
    # hybrid's 2 passes concurrently" update (2026-08-10) means they're back to running at the
    # same time via ThreadPoolExecutor, so every group has to advance in lockstep again, same
    # reasoning as the original 4-tier-concurrent version of this function.
    groups = _build_tier_groups(rulebook)
    if not groups:
        return [], None

    fraction = min(max(progress / 100, 0.0), 1.0)

    out: list[ProgressCategoryOut] = []
    current_category: str | None = None
    for group_key, group_label, items in groups:
        done_count = len(items) if progress >= 100 else int(fraction * len(items))

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
    location_number: str | None
    input_text: str
    criteria: str
    reason: str
    suggestion: str
    frame_type: FrameType
    related_location: str | None
    related_original_text: str | None


# review-agent가 이 MI/AE 재검증을 소스 안에서 직접 정식으로 구현하면서(bundled_screen_hybrid.py
# 상단 주석 참고 — "백엔드는... 우회로 추가했지만, 여긴 소스를 직접 소유하므로 정식으로 구현") 여기
# 있던 _verify_mi_finding/_verify_ae_finding/_FALSE_POSITIVE_VERIFIERS는 review_document()가 이미
# 내부적으로 수행한 검증을 결과에 대고 한 번 더 독립적으로 돌리는 이중 검증이 됐다 — 두 판정 중
# 어느 한쪽만 "없다"고 봐도 그 이슈가 사라지므로, 원래 의도(narrow-context 오탐 제거)보다 훨씬
# 공격적으로 과탐지를 걸러내는 부작용이 있었다. 그래서 삭제하고 review_document()의 판정을 그대로
# 신뢰한다(2026-08-21).


# 관계형·상위목표충돌(GA/LG/LF)이 자구단위 문제(TC/TM)보다 실제 서비스에 미치는 영향이 커서 더
# 시급하다고 보고, 나머지는 대략 "구조적 문제 > 정보 완결성 > 표현 품질" 순으로 배치했다 — 정답이
# 하나로 정해진 값은 아니라 팀 판단이 바뀌면 순서만 조정하면 됨(카테고리 코드는 rulebook_v1.0.md
# §1~8 순서, 이 딕셔너리는 그와 무관하게 시급도로 재배열한 것).
_CATEGORY_PRIORITY: dict[str, int] = {
    "GA": 0,  # 상위 목표와 세부 내용의 정합성 — 문서 자체 목적과 충돌
    "LG": 1,  # 논리비약
    "LF": 2,  # 논리흐름
    "MI": 3,  # 정보 누락
    "RD": 4,  # 불필요한 중복
    "AE": 5,  # 모호한 표현
    "TM": 6,  # 용어 오용
    "TC": 7,  # 용어 및 단어의 일관성
}


def _category_priority(rule_id: str, rulebook: RuleBook) -> int:
    rule = rulebook.rule(rule_id)
    if rule is None:
        return len(_CATEGORY_PRIORITY)
    return _CATEGORY_PRIORITY.get(rule.category, len(_CATEGORY_PRIORITY))


# 같은 문구(위치+인용문)에 서로 다른 카테고리의 룰이 동시에 걸리는 경우가 실사용 중 확인됨(예:
# "용어 오용"과 "상위 목표와의 정합성"이 완전히 같은 입력내용을 가리킴) — 사용자에게 같은 문제를
# 카드 두 개로 중복해서 보여주는 대신, _CATEGORY_PRIORITY로 더 시급한 것 하나만 남긴다. 벤더링된
# dedupe.py의 dedupe_issues()는 "같은 rule_id + 겹치는 위치"만 접도록 의도적으로 짜여 있어서(서로
# 다른 rule_id는 별개 이슈로 보존) 이건 그 위에 얹는 우리 쪽 후처리다.
def _dedupe_conflicting_categories(issues: tuple[ReviewIssue, ...], rulebook: RuleBook) -> tuple[ReviewIssue, ...]:
    best_by_key: dict[tuple[str, str], ReviewIssue] = {}
    passthrough: list[ReviewIssue] = []
    for issue in issues:
        if not issue.original_text or issue.rule_id.startswith(TEAM_RULE_ID_PREFIX):
            # MI(정보 누락) 등 원문 인용이 없는 이슈는 "같은 문구"를 판단할 근거가 없어 건드리지
            # 않는다. 팀 규칙(TEAM-*)도 여기서 건드리지 않는다 — _CATEGORY_PRIORITY는 8개 기본
            # 카테고리의 시급도표라 TEAM은 항상 최하위로 떨어져서, 기본 규칙과 같은 문구를
            # 가리키기만 하면 팀이 일부러 추가한 규칙이 매번 조용히 사라지게 된다.
            passthrough.append(issue)
            continue
        key = (issue.location, issue.original_text)
        existing = best_by_key.get(key)
        if existing is None or _category_priority(issue.rule_id, rulebook) < _category_priority(existing.rule_id, rulebook):
            best_by_key[key] = issue
    return tuple(best_by_key.values()) + tuple(passthrough)


def _run_review_sync(doc_id: str, document_text: str, rulebook: RuleBook) -> ReviewResult:
    # review_agent's AnthropicClient is a blocking/sync client (retry backoff uses time.sleep)
    # — this whole call runs inside asyncio.to_thread so it never blocks the event loop.
    #
    # bundled_screen_hybrid.review_document()이 screen_llm/confirm_llm을 각각 한 번씩 받는
    # 구조라, GeminiClient가 review_agent의 LLMClient 프로토콜(complete_json)만 만족하면 그대로
    # 끼워 넣을 수 있다 — instrumentation.isolate_client()도 GeminiClient에 .isolate()가 따로
    # 없어서 AnthropicClient와 똑같이 copy.copy() + 새 usage 리스트로 안전하게 격리된다(코드 변경
    # 불필요). 1차 스크리닝(저비용, over-flag 의도) = Gemini Flash-Lite, 2차 정밀검증(고비용,
    # 정밀) = Sonnet은 그대로.
    screen_llm = GeminiClient(model=settings.sunnic_gemini_model, api_keys=settings.gemini_api_keys)
    confirm_llm = AnthropicClient(model=settings.sunnic_sonnet_model, api_key=settings.anthropic_api_key)
    result = review_document(doc_id, document_text, rulebook, screen_llm, confirm_llm)

    deduped_issues = _dedupe_conflicting_categories(result.issues, rulebook)
    return replace(result, issues=deduped_issues)


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


# 원문 헤딩 자체에 번호가 있든 없든(작성자마다 제각각이라 신뢰 불가 — 실사용 피드백으로 확인됨)
# 문서 안에서 소주제(logical unit)/그 하위 소소주제(paragraph 위계 헤딩)가 실제로 등장하는 순서를
# 우리가 직접 세어 "2", "2-1" 같은 번호를 계산한다. review_agent의 parse_document를 그대로
# 호출만 하고(벤더링 정책상 그 파일 자체는 안 건드림) 반환된 Chunk.location 문자열을 키로 쓴다 —
# location은 document.py가 헤딩 텍스트를 그대로 담아 만든 값이라, Issue.location과 정확히 같은
# 문자열로 다시 나온다.
def _build_heading_numbers(document_text: str) -> dict[str, str]:
    tree = parse_document("_numbering", document_text)
    numbers: dict[str, str] = {}
    for index, unit in enumerate(tree.logical_units, start=1):
        numbers[unit.location] = str(index)

    sub_index_by_unit: dict[str, int] = {}
    for paragraph in tree.paragraphs:
        if " > " not in paragraph.location:
            continue
        unit_label = paragraph.location.split(" > ", 1)[0]
        unit_number = numbers.get(unit_label)
        if unit_number is None:
            continue
        sub_index_by_unit[unit_label] = sub_index_by_unit.get(unit_label, 0) + 1
        numbers[paragraph.location] = f"{unit_number}-{sub_index_by_unit[unit_label]}"
    return numbers


def _to_issue_record(
    job_id: str, document_text: str, rulebook: RuleBook, issue: ReviewIssue, heading_numbers: dict[str, str]
) -> IssueRecord:
    rule = rulebook.rule(issue.rule_id)
    # _korean_label()은 rulebook_v1.0.md의 "<한글> <English Title Case>" 헤더에서 영어 절반을
    # 잘라내려고 만든 함수라, 팀 규칙의 자유 텍스트 rule_name(category_label로 재사용됨)에 돌리면
    # "회원가입 API 정책" 같은 이름이 첫 영어 단어 앞에서 잘려나간다 — 팀 카테고리는 원문 그대로 쓴다.
    if rule is None:
        criteria = issue.rule_id
    elif rule.category == TEAM_CATEGORY:
        criteria = rule.category_label
    else:
        criteria = _korean_label(rule.category_label)
    related_location = issue.related_location
    frame_type = _frame_type(rule.category, related_location) if rule else FrameType.OBJECT
    input_text = issue.original_text or ""
    start = _issue_start(document_text, input_text, issue.location)
    return IssueRecord(
        id=str(uuid.uuid4()),
        job_id=job_id,
        location=issue.location,
        location_number=heading_numbers.get(issue.location),
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
        related_original_text=issue.related_original_text,
    )


# 2026-08-13 하루에만 두 번 다시 튜닝했다 — 문서 길이 비례 공식(7.5 + 0.014*chars)을 아침에 도입한
# 근거였던 실측(405자 13초 / 2568자 PRD 43초)이 같은 날 오후 MI/AE 검증 호출 병렬화(perf:
# parallelize-mi-ae-verification) 직후 무효화됐다 — 같은 PRD 픽스처가 12초로 줄었는데, 그 병렬화가
# 없앤 건 정확히 "문서 길이에 비례해 늘어나던" 부분(MI/AE 이슈 개수만큼 순차 호출)이었기 때문에
# 문서 길이와 소요 시간의 상관관계 자체가 깨졌다. 병렬화 이후 재실측(짧은 알림 문서 32초, PRD
# 12초 — 오히려 짧은 문서가 더 오래 걸림)도 이를 뒷받침한다: 이제 소요 시간은 길이보다 제미나이
# 무료 티어 rate-limit 백오프(운 나쁘면 20초 단위로 재시도) 쪽 영향이 더 커서, 문서 길이로 미리
# 예측하는 게 오히려 근거 없는 정밀함이었다. 그래서 길이 비례 공식은 버리고 단순 상수로 되돌리되,
# 병렬화 이후 실측 두 점(12초/32초)에서 잔여 점프가 각각 30pp/12pp 정도로 균형 잡히는 tau=8을
# 골랐다. 무료 티어 쿼터가 하루치 테스트로 상당히 소진돼 더 실측하지 않고 이 값으로 마무리한다 —
# 여전히 순수 근사치이고(ADR 0001), 파이프라인이나 쿼터 상황이 또 바뀌면 다시 맞춰야 한다.
_ESTIMATED_DURATION_SECONDS = 8.0


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


async def _execute_qa_job(job_id: str, document_id: str, document_text: str, team_code: str | None = None) -> None:
    job = await store.get_qa_job(job_id)
    if job is None:
        return
    rulebook = _load_rulebook()
    if team_code:
        team_rules = await store.list_team_rules_for_team(team_code)
        rulebook = merge_team_rules(rulebook, [rule for rule in team_rules if rule.enabled])
    ticker: asyncio.Task[None] | None = None
    try:
        ticker = asyncio.create_task(_tick_progress(job_id, job.started_at))
        result = await asyncio.to_thread(_run_review_sync, document_id, document_text, rulebook)
        heading_numbers = _build_heading_numbers(document_text)
        for issue in result.issues:
            await store.save_issue(_to_issue_record(job_id, document_text, rulebook, issue, heading_numbers))
        await store.save_qa_job(job.model_copy(update={"status": QAJobStatus.DONE, "progress": 100}))
    except Exception:
        logger.exception("QA job %s failed for document %s", job_id, document_id)
        await store.save_qa_job(job.model_copy(update={"status": QAJobStatus.FAILED, "progress": 100}))
    finally:
        if ticker is not None:
            ticker.cancel()


class CreateQAJobRequest(BaseModel):
    team_code: str | None = None


@router.post("/documents/{document_id}/qa-jobs", response_model=CreateQAJobResponse)
async def create_qa_job(
    document_id: str, background_tasks: BackgroundTasks, request: CreateQAJobRequest | None = None
) -> CreateQAJobResponse:
    document = await store.get_document(document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="document not found")
    team_code = request.team_code if request else None

    job = QAJob(
        id=str(uuid.uuid4()),
        document_id=document_id,
        status=QAJobStatus.RUNNING,
        progress=0,
        current_category=None,
        started_at=datetime.now(UTC),
    )
    await store.save_qa_job(job)
    background_tasks.add_task(_execute_qa_job, job.id, document_id, document.raw_text, team_code)
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
            location_number=issue.location_number,
            input_text=issue.input_text,
            criteria=issue.criteria,
            reason=issue.reason,
            suggestion=issue.suggestion,
            frame_type=issue.frame_type,
            related_location=issue.related_location,
            related_original_text=issue.related_original_text,
        )
        for issue in issues
    ]
