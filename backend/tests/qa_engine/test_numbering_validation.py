from sunnic_backend.qa_engine.numbering_validation import validate_numbering


def _by_before(issues, before_text):
    matches = [issue for issue in issues if issue.before_text == before_text]
    assert len(matches) == 1, f"expected exactly one issue for {before_text!r}, got {matches}"
    return matches[0]


def test_missing_number_cascades_to_order_error() -> None:
    doc = "\n".join(
        [
            "## 1. 개요",
            "## 2. 문제 정의",
            "## 4. 해결 방안",
            "## 5. 기대 효과",
        ]
    )
    issues = validate_numbering(doc)
    assert len(issues) == 2

    missing = _by_before(issues, "4. 해결 방안")
    assert missing.status == "auto"
    assert missing.sub_type == "missing"
    assert missing.after_text == "3. 해결 방안"

    order = _by_before(issues, "5. 기대 효과")
    assert order.status == "auto"
    assert order.sub_type == "order"
    assert order.after_text == "4. 기대 효과"


def test_duplicate_number_cascades_to_missing() -> None:
    doc = "\n".join(
        [
            "## 1. 개요",
            "## 2. 문제 정의",
            "## 2. 해결 방안",
            "## 3. 기대 효과",
        ]
    )
    issues = validate_numbering(doc)
    assert len(issues) == 2

    duplicate = _by_before(issues, "2. 해결 방안")
    assert duplicate.status == "auto"
    assert duplicate.sub_type == "duplicate"
    assert duplicate.after_text == "3. 해결 방안"

    missing = _by_before(issues, "3. 기대 효과")
    assert missing.status == "auto"
    assert missing.sub_type == "missing"
    assert missing.after_text == "4. 기대 효과"


def test_pure_order_swap() -> None:
    doc = "\n".join(
        [
            "## 1. 개요",
            "## 3. 문제 정의",
            "## 2. 해결 방안",
        ]
    )
    issues = validate_numbering(doc)
    assert len(issues) == 2

    first = _by_before(issues, "3. 문제 정의")
    assert first.sub_type == "order"
    assert first.after_text == "2. 문제 정의"

    second = _by_before(issues, "2. 해결 방안")
    assert second.sub_type == "order"
    assert second.after_text == "3. 해결 방안"


def test_ambiguous_hierarchy_is_flagged_and_excluded_from_siblings() -> None:
    doc = "\n".join(
        [
            "## 1. 배경",
            "## 2. 문제 정의",
            "### 2.1 현황",
            "### 2.2 문제점",
            "## 3. 해결 방안",
            "### 2.3 기대 효과",
        ]
    )
    issues = validate_numbering(doc)
    assert len(issues) == 1

    ambiguous = issues[0]
    assert ambiguous.before_text == "2.3 기대 효과"
    assert ambiguous.status == "confirm"
    assert ambiguous.sub_type == "ambiguous"
    assert ambiguous.after_text is None
    assert ambiguous.location == "3. 해결 방안 > 2.3 기대 효과"


def test_well_numbered_document_has_no_issues() -> None:
    doc = "\n".join(
        [
            "## 1. 개요",
            "## 2. 문제 정의",
            "### 2.1 세부",
            "## 3. 해결 방안",
        ]
    )
    assert validate_numbering(doc) == []


def test_auto_fix_only_replaces_the_number_and_preserves_punctuation() -> None:
    doc = "\n".join(
        [
            "## 1. 개요: 목적과 배경",
            "## 2. 문제 정의",
            "## 4. 해결 방안(안건 A)",
            "## 5. 기대 효과",
        ]
    )
    issues = validate_numbering(doc)
    fixed = _by_before(issues, "4. 해결 방안(안건 A)")
    assert fixed.after_text == "3. 해결 방안(안건 A)"


def test_unnumbered_headings_are_ignored_and_do_not_shift_numbered_siblings() -> None:
    doc = "\n".join(
        [
            "## 부록",
            "## 1. 개요",
            "## 2. 문제 정의",
            "## 참고문헌",
            "## 3. 해결 방안",
        ]
    )
    assert validate_numbering(doc) == []
