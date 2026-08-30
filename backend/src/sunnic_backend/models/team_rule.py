from typing import Literal

from pydantic import BaseModel

# 팀 관리자가 직접 고르는 값이 아니다 — team_rule_classifier.classify_scope()가 rule_name/
# description/exception_text를 보고 자동으로 판정해서 채운다(내장 41개 룰의 카테고리가
# rulebook_v1.0.md 작성자에 의해 미리 정해지는 것과 같은 방식, 팀 룰 작성 폼엔 이 선택지가
# 아예 없음). 세 값의 의미는 review-agent의 실제 dispatch 경계와 정확히 대응한다:
#   paragraph      — 문단 하나만 보고 판단 가능 (문단 단위 pass)
#   relational     — 서로 다른 두 위치를 비교해야 함 (문서 전체를 한 번에 보는 pass, GA/LG/LF와
#                    동일 취급 — team_rule_adapter.team_rule_to_ruledef()가 category="GA"로 세팅)
#   absence_check  — 문서 전체에 걸쳐 "이게 한 번이라도 나왔는지"만 확인 (역시 문서 전체 pass,
#                    review_document()의 extra_absence_check_rule_ids로 개별 rule_id 전달)
TeamRuleScope = Literal["paragraph", "relational", "absence_check"]


class RuleExamplePair(BaseModel):
    error: str = ""
    correction: str = ""


class TeamRuleExamples(BaseModel):
    error1: RuleExamplePair = RuleExamplePair()
    error2: RuleExamplePair = RuleExamplePair()
    exception: str = ""


class TeamRule(BaseModel):
    id: str
    team_code: str
    rule_name: str
    description: str
    exception_text: str | None = None
    examples: TeamRuleExamples = TeamRuleExamples()
    enabled: bool = True
    scope: TeamRuleScope = "paragraph"
