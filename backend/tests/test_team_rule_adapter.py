from sunnic_backend.models.team_rule import RuleExamplePair, TeamRule, TeamRuleExamples
from sunnic_backend.qa_engine.review_agent.planqa_schemas.rulebook import RuleBook
from sunnic_backend.qa_engine.team_rule_adapter import (
    merge_team_rules,
    team_rule_to_ruledef,
)


def _team_rule(**overrides: object) -> TeamRule:
    defaults: dict[str, object] = {
        "id": "abc-123",
        "team_code": "ABC123",
        "rule_name": "정책 정합성",
        "description": "기획서의 정책 관련 내용이 기준 정책 문서와 일치하는지 검토합니다.",
        "exception_text": None,
        "examples": TeamRuleExamples(),
        "enabled": True,
    }
    defaults.update(overrides)
    return TeamRule(**defaults)  # type: ignore[arg-type]


def test_team_rule_to_ruledef_maps_core_fields() -> None:
    rule = _team_rule(exception_text="정책 변경이 확정되었으나 문서에 반영되지 않은 경우")
    ruledef = team_rule_to_ruledef(rule)

    assert ruledef.rule_id == "TEAM-abc-123"
    assert ruledef.category == "TEAM"
    assert ruledef.category_label == "정책 정합성"
    assert ruledef.exception_text == "정책 변경이 확정되었으나 문서에 반영되지 않은 경우"
    assert ruledef.fixed_level is None
    assert ruledef.text.startswith("기획서의 정책 관련 내용이 기준 정책 문서와 일치하는지 검토합니다.")


def test_team_rule_to_ruledef_composes_examples_into_text() -> None:
    rule = _team_rule(
        examples=TeamRuleExamples(
            error1=RuleExamplePair(error="무료 이용자는 월 3회까지 사용할 수 있다.", correction="무료 이용자는 월 5회까지 사용할 수 있다."),
            error2=RuleExamplePair(),
            exception="정책 변경이 확정되었으나 아직 문서가 업데이트되지 않은 경우",
        )
    )
    text = team_rule_to_ruledef(rule).text

    assert "[오류 사례 1] 무료 이용자는 월 3회까지 사용할 수 있다." in text
    assert "[수정 사례 1] 무료 이용자는 월 5회까지 사용할 수 있다." in text
    assert "[오류 사례 2]" not in text
    assert "[예외 사례] 정책 변경이 확정되었으나 아직 문서가 업데이트되지 않은 경우" in text


def test_team_rule_to_ruledef_omits_empty_example_slots() -> None:
    rule = _team_rule(examples=TeamRuleExamples())
    text = team_rule_to_ruledef(rule).text

    assert "[오류 사례 1]" not in text
    assert "[오류 사례 2]" not in text
    assert "[예외 사례]" not in text


def _empty_rulebook() -> RuleBook:
    return RuleBook(rules={}, categories=(), reference_exception_rule_ids=frozenset())


def test_merge_team_rules_with_empty_list_returns_same_object() -> None:
    rulebook = _empty_rulebook()
    merged, absence_check_ids = merge_team_rules(rulebook, [])
    assert merged is rulebook
    assert absence_check_ids == frozenset()


def test_merge_team_rules_adds_synthetic_ruledefs_without_mutating_original() -> None:
    rulebook = _empty_rulebook()
    rule = _team_rule()

    merged, _ = merge_team_rules(rulebook, [rule])

    assert "TEAM-abc-123" in merged.rules
    assert merged.rules["TEAM-abc-123"].category_label == "정책 정합성"
    assert rulebook.rules == {}


def test_merge_team_rules_only_includes_passed_rules() -> None:
    rulebook = _empty_rulebook()
    enabled_rule = _team_rule(id="enabled-1")

    merged, _ = merge_team_rules(rulebook, [enabled_rule])

    assert list(merged.rules.keys()) == ["TEAM-enabled-1"]


def test_team_rule_to_ruledef_uses_ga_category_for_relational_scope() -> None:
    # GA is reused purely as a routing key (bundled_screen_hybrid's whole-document pass) —
    # the model never sees the raw category code, only category_label (team's own rule_name),
    # so this doesn't leak GA's built-in meaning into the prompt.
    rule = _team_rule(scope="relational")
    ruledef = team_rule_to_ruledef(rule)

    assert ruledef.category == "GA"
    assert ruledef.category_label == "정책 정합성"


def test_team_rule_to_ruledef_keeps_team_category_for_absence_check_scope() -> None:
    # absence_check has no reusable category hook — it's routed by rule_id via
    # merge_team_rules()'s second return value instead, so category stays plain TEAM.
    rule = _team_rule(scope="absence_check")
    assert team_rule_to_ruledef(rule).category == "TEAM"


def test_merge_team_rules_reports_absence_check_rule_ids() -> None:
    rulebook = _empty_rulebook()
    absence_rule = _team_rule(id="absence-1", scope="absence_check")
    paragraph_rule = _team_rule(id="paragraph-1", scope="paragraph")
    relational_rule = _team_rule(id="relational-1", scope="relational")

    _, absence_check_ids = merge_team_rules(rulebook, [absence_rule, paragraph_rule, relational_rule])

    assert absence_check_ids == frozenset({"TEAM-absence-1"})
