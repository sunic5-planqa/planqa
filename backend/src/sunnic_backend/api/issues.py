import asyncio
from enum import StrEnum

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from sunnic_backend.config import settings
from sunnic_backend.qa_engine.review_agent.llm.anthropic import AnthropicClient

router = APIRouter(tags=["issues"])

_EDIT_JUDGE_SYSTEM = (
    "You are checking whether a human's edit to a flagged sentence in a Korean product-planning "
    "document (기획서) genuinely addresses a QA reviewer's finding — judge against the underlying "
    "criteria/reason the text was flagged for, NOT against how closely the edit's wording matches "
    "the AI's suggested phrasing. The AI's suggestion may itself be a concrete drop-in replacement "
    "OR just a directional hint (e.g. \"add a specific number here\" rather than exact wording to "
    "paste in) — a human edit that resolves the underlying issue in different words is a pass even "
    "if it reads nothing like the suggestion.\n"
    'Respond with JSON only: {"addresses_issue": <bool>, "reason": "<one short Korean sentence>"}'
)


class SimilarityCheckRequest(BaseModel):
    original_text: str
    criteria: str
    reason: str
    suggestion: str
    edited_text: str


class SimilarityCheckResponse(BaseModel):
    addresses_issue: bool
    reason: str


# 글자 단위 유사도(difflib.SequenceMatcher)였던 걸 LLM 의미 판단으로 교체(2026-08-11, 실사용
# 피드백: "기획자들이 신중하게 고치는데도 표현이 다르면 무조건 경고가 뜬다"). 특히 AI 제안이
# 구체적 대체 문구가 아니라 "~할 것을 고려해보세요" 같은 지시형 안내일 때, 글자 유사도는 사람이
# 아무리 정확하게 고쳐도 항상 낮게 나와 — 검증기준/검증이유까지 같이 주고 "이 수정이 실제로 그
# 문제를 해결했는가"를 직접 물어보는 방식으로 바꿨다. 저비용 모델(Haiku)로 저장 1회당 1콜만 추가.
@router.post("/issues/similarity-check", response_model=SimilarityCheckResponse)
async def check_edit_similarity(request: SimilarityCheckRequest) -> SimilarityCheckResponse:
    llm = AnthropicClient(model=settings.sunnic_haiku_model, api_key=settings.anthropic_api_key)
    prompt = (
        f"Original flagged text: {request.original_text!r}\n"
        f"Criteria (검증기준): {request.criteria!r}\n"
        f"Reason flagged (검증이유): {request.reason!r}\n"
        f"AI's suggestion: {request.suggestion!r}\n"
        f"Human's actual edit: {request.edited_text!r}\n\n"
        "Return the JSON."
    )
    try:
        response = await asyncio.to_thread(llm.complete_json, system=_EDIT_JUDGE_SYSTEM, prompt=prompt)
    except Exception:  # noqa: BLE001 - this check is a safety net, not a hard gate; never block saving on it
        return SimilarityCheckResponse(addresses_issue=True, reason="검사 실패 — 저장을 막지 않습니다")
    if not isinstance(response, dict):
        return SimilarityCheckResponse(addresses_issue=True, reason="검사 응답 이상 — 저장을 막지 않습니다")
    return SimilarityCheckResponse(
        addresses_issue=bool(response.get("addresses_issue", True)),
        reason=str(response.get("reason") or "").strip(),
    )


class IssueAction(StrEnum):
    APPLY = "apply"
    SKIP = "skip"
    EDIT = "edit"


class UpdateIssueRequest(BaseModel):
    action: IssueAction
    edited_text: str | None = None


class UpdateIssueResponse(BaseModel):
    id: str
    status: str


@router.patch("/issues/{issue_id}", response_model=UpdateIssueResponse)
async def update_issue(issue_id: str, request: UpdateIssueRequest) -> UpdateIssueResponse:
    raise HTTPException(status_code=501, detail="issue apply/skip/edit is not implemented yet")
