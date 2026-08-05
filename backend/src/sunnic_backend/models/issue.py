from enum import StrEnum

from pydantic import BaseModel


class IssueStatus(StrEnum):
    PENDING = "pending"
    APPLIED = "applied"
    SKIPPED = "skipped"
    EDITED = "edited"


class Issue(BaseModel):
    id: str
    job_id: str
    location: str
    input_text: str
    criteria: str
    reason: str
    suggestion: str
    status: IssueStatus
    edited_text: str | None
    start: int
    end: int
