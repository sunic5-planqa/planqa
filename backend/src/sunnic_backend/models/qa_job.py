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
    # review_agent가 한 위계(tier)나 참고문서 인덱싱에서 실패해도 다른 결과는 살리고 그 실패만
    # 여기 쌓아둔다(ReviewResult.tier_errors) — 예전엔 이걸 받아놓고 아무 데도 안 써서, XDC가
    # 조용히 0건이 되는 이유를 로그에서조차 확인할 방법이 없었다(2026-09-12 실사용 확인).
    tier_errors: list[str] = []
