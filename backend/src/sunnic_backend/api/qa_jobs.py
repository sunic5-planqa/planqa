import asyncio
import hashlib
import math
import re
import uuid
from collections.abc import Callable
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


_MI_VERIFY_SYSTEM = (
    "You are double-checking a document-review agent's claim that specific information is "
    "missing from a document — this exact failure mode (claiming X is missing when X is "
    "actually stated elsewhere in the document, because the agent's own review only saw one "
    "narrow chunk of it) has been observed live in production. You will be given the FULL "
    "document text and the agent's claim. Re-read the ENTIRE document carefully, not just "
    "whatever section the agent focused on, before deciding.\n"
    'Respond with JSON only: {"actually_missing": <bool>, "reason": "<one short sentence>"}'
)

_AE_VERIFY_SYSTEM = (
    "You are double-checking a document-review agent's claim that a specific phrase is "
    "ambiguous/vague (모호한 표현) — this category is vulnerable to the same narrow-context "
    "failure mode as missing-information claims: a number, referent, or actor that looks "
    "unspecified in isolation may actually be defined or referenced elsewhere in the same "
    "document (e.g. a quantity defined in another section and referenced here per AE-01's own "
    "exception condition, a pronoun whose antecedent is clear from surrounding context, an "
    "actor implied by a system-wide policy stated elsewhere per AE-04's exception). You will "
    "be given the FULL document text and the agent's claim. Re-read the ENTIRE document "
    "carefully, not just whatever section the agent focused on, before deciding whether the "
    "flagged text is genuinely ambiguous in context.\n"
    'Respond with JSON only: {"actually_ambiguous": <bool>, "reason": "<one short sentence>"}'
)


# MI(정보 누락)에서, 문서에 실제로 있는 정보를 "없다"고 잘못 주장하는 오탐이 실사용 중 확인됨
# (DOC-001 "8. 런칭 계획"의 날짜 — 파서는 정확히 뽑아냈는데 confirm이 좁은 chunk만 보고 놓침,
# 2026-08-10). planqa-agent의 services/eval-service(judge.py)로 걸러볼 수 있는지 먼저 검토했으나,
# 그건 문서 원문 없이 에이전트 본인의 근거/이유만 재검토하는 reference-free 구조라
# (judge_review_result가 document_text를 아예 안 받음) "근거 자체는 논리적이지만 전제가 문서와
# 안 맞는" 이런 유형은 애초에 못 잡는다 — 그래서 대신 여기서 문서 전체를 다시 보여주고 재확인한다.
# AE(모호한 표현)도 같은 방식으로 추가(2026-08-11, 실사용 과탐지 재보고) — AE-01/AE-04 예외조건이
# 둘 다 "문서 다른 곳에 정의/참조돼 있으면 예외"라, 좁은 chunk만 본 confirm이 그 정의를 놓치고
# "모호하다"고 오판하는 게 MI와 정확히 같은 실패 패턴이기 때문. 나머지 카테고리로는 안 넓힘 — 이
# 둘만 "문서 전체를 봐야 판단 가능한 예외조건"을 갖고 있고, 모든 카테고리에 걸면 비용/시간이
# 크게 늘어난다.
def _verify_mi_finding(document_text: str, issue: ReviewIssue, llm: AnthropicClient) -> bool:
    prompt = (
        f"Full document:\n{document_text}\n\n"
        f"Agent's claim — location: {issue.location!r}\n"
        f"  what's allegedly missing: {issue.description!r}\n"
        f"  rationale: {issue.rationale!r}\n"
        f"  quoted context: {issue.original_text!r}\n\n"
        "Return the JSON."
    )
    try:
        response = llm.complete_json(system=_MI_VERIFY_SYSTEM, prompt=prompt)
    except Exception:  # noqa: BLE001 - a verification failure must not block/hide the original finding
        return True
    if not isinstance(response, dict):
        return True
    return bool(response.get("actually_missing", True))


def _verify_ae_finding(document_text: str, issue: ReviewIssue, llm: AnthropicClient) -> bool:
    prompt = (
        f"Full document:\n{document_text}\n\n"
        f"Agent's claim — location: {issue.location!r}\n"
        f"  flagged text: {issue.original_text!r}\n"
        f"  what's allegedly ambiguous: {issue.description!r}\n"
        f"  rationale: {issue.rationale!r}\n\n"
        "Return the JSON."
    )
    try:
        response = llm.complete_json(system=_AE_VERIFY_SYSTEM, prompt=prompt)
    except Exception:  # noqa: BLE001 - a verification failure must not block/hide the original finding
        return True
    if not isinstance(response, dict):
        return True
    return bool(response.get("actually_ambiguous", True))


_FALSE_POSITIVE_VERIFIERS: dict[str, Callable[[str, ReviewIssue, AnthropicClient], bool]] = {
    "MI": _verify_mi_finding,
    "AE": _verify_ae_finding,
}


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
        if not issue.original_text:
            # MI(정보 누락) 등 원문 인용이 없는 이슈는 "같은 문구"를 판단할 근거가 없다 — 잘못
            # 묶으면 서로 다른 결측 항목이 하나로 사라질 수 있어 건드리지 않는다.
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
    # bundled_screen_hybrid.review_document() (2026-08-10 재벤더링) calls screen_llm/confirm_llm
    # directly and sequentially (Paragraph pass, then Document pass) — unlike the old
    # category_screen structure, nothing here runs concurrently, so LLMClient.clone() is never
    # called and the _ScopedClient workaround built for it (see docs/adr/0001-...) is gone —
    # explicit api_key= is threaded straight through the constructor, same as before.
    # 1차 스크리닝(저비용, over-flag 의도) = Haiku, 2차 정밀검증(고비용, 정밀) = Sonnet.
    screen_llm = AnthropicClient(model=settings.sunnic_haiku_model, api_key=settings.anthropic_api_key)
    confirm_llm = AnthropicClient(model=settings.sunnic_sonnet_model, api_key=settings.anthropic_api_key)
    result = review_document(doc_id, document_text, rulebook, screen_llm, confirm_llm)

    verified_issues = tuple(
        issue
        for issue in result.issues
        if (rule := rulebook.rule(issue.rule_id)) is None
        or (verify := _FALSE_POSITIVE_VERIFIERS.get(rule.category)) is None
        or verify(document_text, issue, confirm_llm)
    )
    deduped_issues = _dedupe_conflicting_categories(verified_issues, rulebook)
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
    criteria = _korean_label(rule.category_label) if rule else issue.rule_id
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
    )


# 30s — 20s에서 올림(2026-08-11, 실사용 피드백: "80%까지는 빠르게 가다가 거기서 급 느려진다").
# 1-exp(-t/tau) 곡선은 점근선 특성상 tau가 작을수록 초반에 빨리 오르고 그만큼 남은 구간(예:
# 80%→90%)에서 체감상 정체되는 시간이 길어진다 — tau=20일 때 실측 완료 시점(~63.1초, 2패스 동시
# 실행 기준)까지 80%는 이미 32초 만에 도달해, 남은 31초(전체의 절반 가까이)가 "멈춘 것처럼" 보이는
# 구간이었다. tau=30이면 80% 도달이 48초로 늦춰져 완료 시점에 더 가까워지고, 그만큼 정체 체감 구간이
# 짧아진다(대신 t=63.1s일 때 진행률은 ≈87%로 tau=20 때의 ≈86%와 거의 같아 "완료 훨씬 전에 90% 도달"
# 쪽 오차는 커지지 않는다). 이 값은 여전히 순수 근사치이고(실제 per-tier 진행 신호 없음, ADR
# 0001), 두 패스의 실제 소요시간이 크게 바뀌면(문서 길이, GA/LG/LF 후보 수 등에 따라 Document
# 패스가 특히 늘어질 수 있음) 다시 조정이 필요할 수 있다.
_ESTIMATED_DURATION_SECONDS = 30.0


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
        heading_numbers = _build_heading_numbers(document_text)
        for issue in result.issues:
            await store.save_issue(_to_issue_record(job_id, document_text, rulebook, issue, heading_numbers))
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
            location_number=issue.location_number,
            input_text=issue.input_text,
            criteria=issue.criteria,
            reason=issue.reason,
            suggestion=issue.suggestion,
            frame_type=issue.frame_type,
            related_location=issue.related_location,
        )
        for issue in issues
    ]
