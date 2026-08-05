from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(tags=["qa-jobs"])

_NOT_IMPLEMENTED = "QA engine is not implemented yet"


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


@router.post("/documents/{document_id}/qa-jobs", response_model=CreateQAJobResponse)
async def create_qa_job(document_id: str) -> CreateQAJobResponse:
    raise HTTPException(status_code=501, detail=_NOT_IMPLEMENTED)


@router.get("/qa-jobs/{job_id}/status", response_model=QAJobStatusResponse)
async def get_qa_job_status(job_id: str) -> QAJobStatusResponse:
    raise HTTPException(status_code=501, detail=_NOT_IMPLEMENTED)


@router.get("/qa-jobs/{job_id}/issues", response_model=list[IssueResponse])
async def list_qa_job_issues(job_id: str) -> list[IssueResponse]:
    raise HTTPException(status_code=501, detail=_NOT_IMPLEMENTED)
