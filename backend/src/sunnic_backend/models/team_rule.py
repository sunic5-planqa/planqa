from pydantic import BaseModel


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
