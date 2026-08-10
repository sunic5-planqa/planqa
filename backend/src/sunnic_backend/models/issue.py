from enum import StrEnum

from pydantic import BaseModel


class IssueStatus(StrEnum):
    PENDING = "pending"
    APPLIED = "applied"
    SKIPPED = "skipped"
    EDITED = "edited"


class FrameType(StrEnum):
    # 문서 위 하이라이트 박스를 어떻게 그릴지 — QA 기준(rule_id 카테고리)에서 결정된다.
    # object: 오류가 발생한 단일 위치만 (TC/TM/AE/RD)
    # insert_range: 정보가 누락된 자리를 포함하는 최소 상위 위계 (MI)
    # range: 두 위치(location~related_location) 사이 전체 (LG/LF/GA — related_location 없으면 object로 폴백)
    OBJECT = "object"
    RANGE = "range"
    INSERT_RANGE = "insert_range"


class Issue(BaseModel):
    id: str
    job_id: str
    location: str
    location_number: str | None = None
    input_text: str
    criteria: str
    reason: str
    suggestion: str
    status: IssueStatus
    edited_text: str | None
    start: int
    end: int
    frame_type: FrameType = FrameType.OBJECT
    related_location: str | None = None
    related_original_text: str | None = None
