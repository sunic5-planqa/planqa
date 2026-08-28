from __future__ import annotations

from sunnic_backend.qa_engine.review_agent.document import Chunk
from sunnic_backend.qa_engine.review_agent.llm.base import LLMClient
from sunnic_backend.qa_engine.review_agent.planqa_schemas.schema import Issue as ReviewIssue
from sunnic_backend.qa_engine.review_agent.xdc_extraction import (
    extract_confirmed_statements,
    extract_reference_statements,
)
from sunnic_backend.qa_engine.review_agent.xdc_matching import CandidatePair, ReferenceSentence, top_candidate_pairs

_XDC_RULES = """\
XDC-01. 핵심 정책값 불일치
같은 대상·속성·적용 범위에 대해 수수료율, 고객 부담금, 사용/신청 기간, 처리 기한, 금액, \
횟수, 할인율, 한도 등 확정값이 참고문서와 다르면 지적한다. 서로 다른 상품·사용자군·사유· \
출시 단계에 적용되는 값이거나, 참고문서가 허용한 범위 안의 세부값인 경우는 예외.

XDC-02. 정책 적용 범위 불일치
같은 정책의 대상 지역, 사용자군, 상품군, 주문 조건, 반품 사유, 채널 또는 제외 대상이 \
참고문서보다 넓거나 좁게 쓰였으면 지적한다. 현재 문단이 별도 상품·별도 사용자군·별도 \
운영 채널임을 명확히 밝힌 경우는 예외.

XDC-03. 정책 처리 결과 불일치
가능/불가, 승인/거절, 자동/수동, 취소/환불/교환 가능 여부, 상태 변경 결과, 알림·정산· \
배송 처리 결과가 같은 상황에서 참고문서와 반대면 지적한다. 참고문서가 선택지·조건부 \
처리·운영자 재량을 명시한 경우는 예외.

XDC-04. 확정 변경사항 미반영
참고문서의 변경 이력 또는 본문이 이전값과 변경 후 값을 명시하고, 현재 문단이 같은 \
사항에 이전값을 현재 정책처럼 쓰면 지적한다(XDC-01·02와 중복 보고하지 않고 우선 적용). \
현재 문단이 과거 정책 설명·변경 전후 비교·롤백 계획임을 명확히 표시한 경우는 예외.
"""

_XDC_CONFIRM_SYSTEM = (
    "You compare one paragraph from a service planning document against candidate sentences "
    "from separate reference documents (already-confirmed decisions) to find contradictions.\n\n"
    f"Rules:\n{_XDC_RULES}\n"
    "Only report an issue when ALL of these hold: (1) the current paragraph and the reference "
    "sentence describe the same service matter, (2) the reference sentence states an actually "
    "confirmed value/scope/result, (3) the current paragraph's content differs from it, "
    "(4) this isn't an explicit exception (different target, different rollout stage, etc).\n"
    'Respond with JSON only: {"issues": [{"rule_id": "XDC-01", "reference_index": <int>, '
    '"original_text": "<exact quote from the current paragraph>", "description": "<one line>", '
    '"rationale": "<why this contradicts the reference>", "fix_direction": "<how to fix>"}]}. '
    "reference_index refers to the numbered candidate list below. Return an empty array if "
    "nothing qualifies."
)


def _candidates_prompt(current: Chunk, candidates: list[CandidatePair]) -> str:
    lines = [f"Current paragraph ({current.location}):\n{current.text}\n", "Candidate reference sentences:"]
    for index, pair in enumerate(candidates):
        ref = pair.reference
        lines.append(f"[{index}] ({ref.doc_id} / {ref.chunk.location}) {ref.chunk.text}")
    return "\n".join(lines)


def confirm_xdc_issues(doc_id: str, current: Chunk, candidates: list[CandidatePair], llm: LLMClient) -> list[ReviewIssue]:
    if not candidates:
        return []
    try:
        response = llm.complete_json(system=_XDC_CONFIRM_SYSTEM, prompt=_candidates_prompt(current, candidates))
    except Exception:  # noqa: BLE001 - 정밀 판정 실패가 전체 QA 파이프라인을 죽이면 안 된다
        return []
    if not isinstance(response, dict):
        return []
    raw_issues = response.get("issues", [])
    if not isinstance(raw_issues, list):
        return []

    issues: list[ReviewIssue] = []
    for raw in raw_issues:
        if not isinstance(raw, dict):
            continue
        reference_index = raw.get("reference_index")
        if not isinstance(reference_index, int) or not (0 <= reference_index < len(candidates)):
            continue
        reference = candidates[reference_index].reference
        issues.append(
            ReviewIssue(
                doc_id=doc_id,
                level=current.level.value,
                rule_id=str(raw.get("rule_id", "")),
                location=current.location,
                original_text=str(raw.get("original_text", "")),
                description=str(raw.get("description", "")),
                rationale=str(raw.get("rationale", "")),
                fix_direction=str(raw.get("fix_direction", "")),
                # 참고문서 출처는 전용 필드가 없어 related_location에 doc_id를 prefix로 붙여 임시 표기
                related_location=f"[{reference.doc_id}] {reference.chunk.location}",
                related_original_text=reference.chunk.text,
            )
        )
    return issues


def review_cross_document(
    current_doc_id: str,
    current_text: str,
    reference_docs: list[tuple[str, str]],
    screen_llm: LLMClient,
    confirm_llm: LLMClient,
) -> tuple[ReviewIssue, ...]:
    current_chunks = extract_confirmed_statements(current_doc_id, current_text, screen_llm)

    reference_sentences: list[ReferenceSentence] = []
    for reference_doc_id, reference_text in reference_docs:
        reference_sentences.extend(extract_reference_statements(reference_doc_id, reference_text, screen_llm))

    pairs = top_candidate_pairs(current_chunks, reference_sentences)

    grouped: dict[Chunk, list[CandidatePair]] = {}
    for pair in pairs:
        grouped.setdefault(pair.current, []).append(pair)

    issues: list[ReviewIssue] = []
    for current_chunk, candidates in grouped.items():
        issues.extend(confirm_xdc_issues(current_doc_id, current_chunk, candidates, confirm_llm))
    return tuple(issues)
