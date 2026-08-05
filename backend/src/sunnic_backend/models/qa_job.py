from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel


class QAJobStatus(StrEnum):
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


class QAJob(BaseModel):
    id: str
    document_id: str
    status: QAJobStatus
    progress: int
    current_category: str | None
    started_at: datetime
