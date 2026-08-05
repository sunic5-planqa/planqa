from enum import StrEnum

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(tags=["issues"])


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
