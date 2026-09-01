from typing import Literal

from pydantic import BaseModel

NumberingIssueStatus = Literal["auto", "confirm"]
NumberingIssueSubType = Literal["missing", "duplicate", "order", "ambiguous"]


class NumberingIssue(BaseModel):
    id: str
    status: NumberingIssueStatus
    sub_type: NumberingIssueSubType
    location: str
    problem: str
    before_text: str
    after_text: str | None = None
