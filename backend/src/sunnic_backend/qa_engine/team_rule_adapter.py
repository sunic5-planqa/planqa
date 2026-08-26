from dataclasses import replace

from sunnic_backend.models.team_rule import TeamRule
from sunnic_backend.qa_engine.review_agent.planqa_schemas.rulebook import (
    RuleBook,
    RuleDef,
)

# Public (no leading underscore) because qa_jobs.py needs these to special-case synthetic
# team-rule issues: TEAM isn't a real rulebook_v1.0.md category, so category-keyed logic that
# assumes the 8 built-in categories (_korean_label, _CATEGORY_PRIORITY dedup) must recognize it.
TEAM_CATEGORY = "TEAM"
TEAM_RULE_ID_PREFIX = "TEAM-"


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
        rule_id=f"{TEAM_RULE_ID_PREFIX}{rule.id}",
        category=TEAM_CATEGORY,
        category_label=rule.rule_name,
        text=_compose_rule_text(rule),
        fixed_level=None,
        exception_text=rule.exception_text,
    )


def merge_team_rules(rulebook: RuleBook, team_rules: list[TeamRule]) -> RuleBook:
    if not team_rules:
        return rulebook
    extra = {f"{TEAM_RULE_ID_PREFIX}{rule.id}": team_rule_to_ruledef(rule) for rule in team_rules}
    return replace(rulebook, rules={**rulebook.rules, **extra})
