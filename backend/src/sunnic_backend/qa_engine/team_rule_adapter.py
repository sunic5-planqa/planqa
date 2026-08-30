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

# A team rule classified scope="relational" (team_rule_classifier.classify_scope) is tagged
# with this real built-in category instead of TEAM_CATEGORY — bundled_screen_hybrid.py's
# _RELATIONAL_CATEGORIES check (category in {LG, LF, GA}) is what actually routes a rule to
# the whole-document pass and turns on related_location/related_original_text extraction, and
# that check is closed over exactly those three literal strings, not open to a new one. GA is
# picked arbitrarily among the three (the model never sees the raw category code — _hybrid_
# block() only interpolates category_label, which stays the team's own rule_name — so which
# of the three we pick has no prompt-visible effect, only routing/frame-type/dedupe-priority
# side effects, all of which are fine to inherit from GA).
RELATIONAL_SCOPE_CATEGORY = "GA"


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
    category = RELATIONAL_SCOPE_CATEGORY if rule.scope == "relational" else TEAM_CATEGORY
    return RuleDef(
        rule_id=f"{TEAM_RULE_ID_PREFIX}{rule.id}",
        category=category,
        category_label=rule.rule_name,
        text=_compose_rule_text(rule),
        fixed_level=None,
        exception_text=rule.exception_text,
    )


def merge_team_rules(rulebook: RuleBook, team_rules: list[TeamRule]) -> tuple[RuleBook, frozenset[str]]:
    """Returns the merged rulebook plus the rule_ids of any scope="absence_check" team
    rules — unlike "relational" (handled above by reusing GA's category), absence-check has
    no reusable category hook (ABSENCE_CHECK_RULE_IDS in the vendored bundled_screen_hybrid.py
    is a closed set of two literal built-in rule_ids, LG-01/TC-02, not a category). The caller
    must pass this set into review_document(extra_absence_check_rule_ids=...) itself."""
    if not team_rules:
        return rulebook, frozenset()
    extra = {f"{TEAM_RULE_ID_PREFIX}{rule.id}": team_rule_to_ruledef(rule) for rule in team_rules}
    merged = replace(rulebook, rules={**rulebook.rules, **extra})
    absence_check_ids = frozenset(
        f"{TEAM_RULE_ID_PREFIX}{rule.id}" for rule in team_rules if rule.scope == "absence_check"
    )
    return merged, absence_check_ids
