from dataclasses import replace

from sunnic_backend.models.team_rule import TeamRule
from sunnic_backend.qa_engine.review_agent.planqa_schemas.rulebook import (
    RuleBook,
    RuleDef,
)

_TEAM_CATEGORY = "TEAM"
_TEAM_RULE_ID_PREFIX = "TEAM-"


def _compose_rule_text(rule: TeamRule) -> str:
    # RuleDef.text is a free-form string that _hybrid_block() interpolates without any parsing,
    # so this is the only place team-rule examples can reach the existing prompt without touching
    # the vendored bundled_screen_hybrid.py/fewshot_bank.py few-shot machinery (out of scope here).
    parts = [rule.description]
    examples = rule.examples
    if examples.error1.error or examples.error1.correction:
        parts.append(f"[오류 사례 1] {examples.error1.error}")
        parts.append(f"[수정 사례 1] {examples.error1.correction}")
    if examples.error2.error or examples.error2.correction:
        parts.append(f"[오류 사례 2] {examples.error2.error}")
        parts.append(f"[수정 사례 2] {examples.error2.correction}")
    if examples.exception:
        parts.append(f"[예외 사례] {examples.exception}")
    return "\n".join(parts)


def team_rule_to_ruledef(rule: TeamRule) -> RuleDef:
    return RuleDef(
        rule_id=f"{_TEAM_RULE_ID_PREFIX}{rule.id}",
        category=_TEAM_CATEGORY,
        category_label=rule.rule_name,
        text=_compose_rule_text(rule),
        fixed_level=None,
        exception_text=rule.exception_text,
    )


def merge_team_rules(rulebook: RuleBook, team_rules: list[TeamRule]) -> RuleBook:
    if not team_rules:
        return rulebook
    extra = {f"{_TEAM_RULE_ID_PREFIX}{rule.id}": team_rule_to_ruledef(rule) for rule in team_rules}
    return replace(rulebook, rules={**rulebook.rules, **extra})
