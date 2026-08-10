import difflib
from enum import StrEnum

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(tags=["issues"])

# AI 제안과 사람이 실제로 고친 텍스트가 너무 다르면(의도한 수정이 아닐 수 있음) 저장 전에 한 번
# 경고하기 위한 임계값 — extension의 옛 클라이언트 사이드 Levenshtein 체크(editValidation.ts)와
# 같은 기준(0.3)을 유지해 체감 동작이 바뀌지 않게 했다. difflib.SequenceMatcher는 표준 라이브러리라
# 외부 API 호출/쿼터 소모 없이 계산된다 — LLM 기반 의미 유사도가 아니라 문자열 유사도라는 한계는 있음.
_SIMILARITY_THRESHOLD = 0.3


class SimilarityCheckRequest(BaseModel):
    suggestion: str
    edited_text: str


class SimilarityCheckResponse(BaseModel):
    similarity: float
    matches_closely: bool


@router.post("/issues/similarity-check", response_model=SimilarityCheckResponse)
async def check_edit_similarity(request: SimilarityCheckRequest) -> SimilarityCheckResponse:
    ratio = difflib.SequenceMatcher(None, request.suggestion, request.edited_text).ratio()
    return SimilarityCheckResponse(similarity=ratio, matches_closely=ratio >= _SIMILARITY_THRESHOLD)


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
