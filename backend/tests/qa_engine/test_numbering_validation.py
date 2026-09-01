from sunnic_backend.qa_engine.numbering_validation import validate_numbering


def _by_before(issues, before_text):
    matches = [issue for issue in issues if issue.before_text == before_text]
    assert len(matches) == 1, f"expected exactly one issue for {before_text!r}, got {matches}"
    return matches[0]


def test_missing_number_cascades_to_order_error() -> None:
    doc = "## 1. 개요\n## 2. 문제 정의\n## 4. 해결 방안\n## 5. 기대 효과"
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
    doc = "## 1. 개요\n## 2. 문제 정의\n## 2. 해결 방안\n## 3. 기대 효과"
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
    doc = "## 1. 개요\n## 3. 문제 정의\n## 2. 해결 방안"
    issues = validate_numbering(doc)
    assert len(issues) == 2

    first = _by_before(issues, "3. 문제 정의")
    assert first.sub_type == "order"
    assert first.after_text == "2. 문제 정의"

    second = _by_before(issues, "2. 해결 방안")
    assert second.sub_type == "order"
    assert second.after_text == "3. 해결 방안"


def test_ambiguous_hierarchy_is_flagged_and_excluded_from_siblings() -> None:
    doc = "## 1. 배경\n## 2. 문제 정의\n### 2.1 현황\n### 2.2 문제점\n## 3. 해결 방안\n### 2.3 기대 효과"
    issues = validate_numbering(doc)
    assert len(issues) == 1

    ambiguous = issues[0]
    assert ambiguous.before_text == "2.3 기대 효과"
    assert ambiguous.status == "confirm"
    assert ambiguous.sub_type == "ambiguous"
    assert ambiguous.after_text is None
    assert ambiguous.location == "3. 해결 방안 > 2.3 기대 효과"


def test_well_numbered_document_has_no_issues() -> None:
    doc = "## 1. 개요\n## 2. 문제 정의\n### 2.1 세부\n## 3. 해결 방안"
    assert validate_numbering(doc) == []


def test_auto_fix_only_replaces_the_number_and_preserves_punctuation() -> None:
    doc = "## 1. 개요: 목적과 배경\n## 2. 문제 정의\n## 4. 해결 방안(안건 A)\n## 5. 기대 효과"
    issues = validate_numbering(doc)
    fixed = _by_before(issues, "4. 해결 방안(안건 A)")
    assert fixed.after_text == "3. 해결 방안(안건 A)"


def test_unnumbered_headings_are_ignored_and_do_not_shift_numbered_siblings() -> None:
    doc = "## 부록\n## 1. 개요\n## 2. 문제 정의\n## 참고문헌\n## 3. 해결 방안"
    assert validate_numbering(doc) == []


def test_numbered_h1_sections_with_numbered_h2_subsections_have_no_false_positives() -> None:
    # 실사용 중 확인된 버그: h1이 "01. 혜택 알림 운영 개요"처럼 번호가 매겨진 대주제로 쓰이는
    # 문서에서, h1을 헤딩으로 인식하지 못하면 그 밑의 h2들이 전부 구조적 부모 없이 하나의 형제
    # 그룹으로 뒤섞여 서로 다른 대주제 밑의 정상적인 소주제("1-1"과 "2-1")까지 오탐이 났다.
    doc = "# 01. 혜택 알림 운영 개요\n## 1-1. 목적\n## 1-2. 적용 범위\n## 1-3. 운영 목표\n## 1-4. 용어 정의\n# 02. 혜택 대상 관리\n## 2-1. 발송 대상 선정\n## 2-2. 대상 제외 기준"
    assert validate_numbering(doc) == []


def test_subsection_moved_to_a_different_h1_but_kept_its_old_number_is_ambiguous_not_auto_fixed() -> None:
    # 사용자가 01 밑의 소주제 일부를 02 밑으로 옮겼지만 번호("1-2", "1-3")는 그대로 둔 경우 — 이건
    # "번호 자체가 틀렸다"가 아니라 "사용자가 구조를 옮기면서 번호 체계가 달라진 것"이라 AI가 임의로
    # "2-2"/"2-3"으로 자동 수정하면 안 된다. 계층 구조(부모=02)와 번호 prefix(1)가 다르므로 모호로
    # 검출하고 자동 수정 후보(형제 그룹)에서는 제외해야 한다. 제자리에 남은 "1-1"과 "2-1"은 정상.
    doc = "# 01. 혜택 알림 운영 개요\n## 1-1. 목적\n# 02. 혜택 대상 관리\n## 2-1. 발송 대상 선정\n## 1-2. 적용 범위\n## 1-3. 운영 목표"
    issues = validate_numbering(doc)
    assert len(issues) == 2

    moved_first = _by_before(issues, "1-2. 적용 범위")
    assert moved_first.status == "confirm"
    assert moved_first.sub_type == "ambiguous"
    assert moved_first.after_text is None
    assert moved_first.location == "02. 혜택 대상 관리 > 1-2. 적용 범위"

    moved_second = _by_before(issues, "1-3. 운영 목표")
    assert moved_second.status == "confirm"
    assert moved_second.sub_type == "ambiguous"
    assert moved_second.after_text is None


def test_auto_fix_within_numbered_h1_section_keeps_the_local_dash_separator_and_unpadded_prefix() -> None:
    # expected 번호를 부모의 원문 그대로("01")로 이어붙이면 "01.3"처럼 이 문서의 실제 표기
    # 스타일(대시, 0 패딩 없음)과 안 맞는 제안이 나간다 — 틀리지 않았다고 이미 확인된 형제 자신의
    # dot-prefix/구분자 스타일을 재사용해야 한다.
    doc = "# 01. 혜택 알림 운영 개요\n## 1-1. 목적\n## 1-2. 적용 범위\n## 1-4. 용어 정의"
    issues = validate_numbering(doc)
    assert len(issues) == 1

    missing = issues[0]
    assert missing.before_text == "1-4. 용어 정의"
    assert missing.sub_type == "missing"
    assert missing.after_text == "1-3. 용어 정의"


def test_first_subsection_under_h1_1_is_expected_to_start_at_1_not_2() -> None:
    # 실사용 중 "off-by-one" 의심 보고: 소주제 형제 그룹의 첫 expected 값이 2부터 시작하는 게
    # 아닌지 확인하는 회귀 테스트 — enumerate(siblings)가 index=0부터 돌고 expected_value=index+1을
    # 쓰므로 첫 형제는 항상 expected_value=1이어야 정상이다.
    doc = "# 1. 대주제\n## 1-1. 첫 번째\n## 1-2. 두 번째\n## 1-3. 세 번째"
    assert validate_numbering(doc) == []


def test_first_subsection_under_h1_2_is_expected_to_start_at_1_not_2() -> None:
    # 부모 번호가 2여도(1이 아니어도) 소주제 형제 그룹 자체의 첫 expected 값은 여전히 1부터
    # 시작해야 한다("2-2"가 아니라 "2-1") — 부모가 1일 때만 우연히 맞는 게 아님을 확인한다. h1
    # "2. 대주제"가 이 raw_text에서 유일한 최상위 헤딩이면 최상위 형제 그룹(대주제 자신의 번호가
    # 1부터 시작해야 한다는, 이건 소주제 버그와 무관한 별개의 기존 규칙) 검사에 걸리므로, 실제
    # 문서처럼 "1. ..." 대주제를 하나 앞에 둬서 최상위 그룹은 [1, 2]로 정상이 되게 하고 "2번
    # 대주제의 소주제"만 검사 대상으로 좁힌다.
    doc = "# 1. 이전 대주제\n# 2. 대주제\n## 2-1. 첫 번째\n## 2-2. 두 번째\n## 2-3. 세 번째"
    assert validate_numbering(doc) == []


def test_subsections_shifted_by_one_are_all_flagged_with_expected_starting_at_1() -> None:
    # 소주제가 "1-2, 1-3, 1-4"로 시작하고(정상이라면 "1-1"부터 시작해야 함) 있는 경우 — 3개 전부
    # 오류로 검출되어야 하고, 각각의 expected는 1-1, 1-2, 1-3이어야 한다(2-1, 2-2, 2-3이 아님).
    doc = "# 1. 대주제\n## 1-2. 첫 번째\n## 1-3. 두 번째\n## 1-4. 세 번째"
    issues = validate_numbering(doc)
    assert len(issues) == 3

    first = _by_before(issues, "1-2. 첫 번째")
    assert first.sub_type == "missing"
    assert first.after_text == "1-1. 첫 번째"

    second = _by_before(issues, "1-3. 두 번째")
    assert second.sub_type == "order"
    assert second.after_text == "1-2. 두 번째"

    third = _by_before(issues, "1-4. 세 번째")
    assert third.sub_type == "order"
    assert third.after_text == "1-3. 세 번째"


# ---------------------------------------------------------------------------
# Baseline regression — 실제 서비스 문서 전체 구조. 이 테스트가 실패하면 그 자체로 회귀다.
# ---------------------------------------------------------------------------
def test_real_world_baseline_document_with_three_h1_sections_has_no_issues() -> None:
    doc = "# 1. 혜택 알림 운영 개요\n\n## 1-1. 목적\n\n## 1-2. 적용 범위\n\n## 1-3. 운영 목표\n\n## 1-4. 용어 정의\n\n## 1-5. 운영 지표\n\n## 1-6. 데이터 관리\n\n\n# 2. 혜택 대상 관리\n\n## 2-1. 발송 대상 선정\n\n## 2-2. 대상 제외 기준\n\n## 2-3. 혜택 유형 관리\n\n## 2-4. 우선순위 정책\n\n## 2-5. 운영 로그\n\n\n# 3. 혜택 알림 운영 기준\n\n## 3-1. 발송 유형\n\n## 3-2. 발송 채널\n\n## 3-3. 발송 실패 처리\n\n## 3-4. 운영 모니터링\n\n## 3-5. KPI"
    assert validate_numbering(doc) == []


# ---------------------------------------------------------------------------
# 대주제(H1) 자신의 sibling group 판정 — 소주제와 별개의 numbering domain.
# ---------------------------------------------------------------------------
def test_h1_section_missing() -> None:
    doc = "# 1. 개요\n# 3. 문제 정의"
    issues = validate_numbering(doc)
    assert len(issues) == 1
    assert issues[0].sub_type == "missing"
    assert issues[0].before_text == "3. 문제 정의"
    assert issues[0].after_text == "2. 문제 정의"


def test_h1_section_duplicate() -> None:
    doc = "# 1. 개요\n# 2. 문제 정의\n# 2. 해결 방안"
    issues = validate_numbering(doc)
    assert len(issues) == 1
    assert issues[0].sub_type == "duplicate"
    assert issues[0].before_text == "2. 해결 방안"
    assert issues[0].after_text == "3. 해결 방안"


def test_h1_section_order() -> None:
    doc = "# 1. 개요\n# 3. 해결 방안\n# 2. 문제 정의"
    issues = validate_numbering(doc)
    assert len(issues) == 2

    first = _by_before(issues, "3. 해결 방안")
    assert first.sub_type == "order"
    assert first.after_text == "2. 해결 방안"

    second = _by_before(issues, "2. 문제 정의")
    assert second.sub_type == "order"
    assert second.after_text == "3. 문제 정의"


# ---------------------------------------------------------------------------
# 소주제(H2, "1-1" 형식) sibling group 판정 — 위 H2("1.") 형식과 별개로 대시 표기도 동일하게 동작.
# ---------------------------------------------------------------------------
def test_dash_style_subsection_missing() -> None:
    doc = "# 1. 개요\n## 1-1. 목적\n## 1-3. 목표"
    issues = validate_numbering(doc)
    assert len(issues) == 1
    assert issues[0].sub_type == "missing"
    assert issues[0].before_text == "1-3. 목표"
    assert issues[0].after_text == "1-2. 목표"


def test_dash_style_subsection_duplicate() -> None:
    doc = "# 1. 개요\n## 1-1. 목적\n## 1-2. 범위\n## 1-2. 목표"
    issues = validate_numbering(doc)
    assert len(issues) == 1
    assert issues[0].sub_type == "duplicate"
    assert issues[0].before_text == "1-2. 목표"
    assert issues[0].after_text == "1-3. 목표"


def test_dash_style_subsection_order() -> None:
    doc = "# 1. 개요\n## 1-1. 목적\n## 1-3. 목표\n## 1-2. 범위"
    issues = validate_numbering(doc)
    assert len(issues) == 2

    first = _by_before(issues, "1-3. 목표")
    assert first.sub_type == "order"
    assert first.after_text == "1-2. 목표"

    second = _by_before(issues, "1-2. 범위")
    assert second.sub_type == "order"
    assert second.after_text == "1-3. 범위"


def test_dash_style_subsection_ambiguous_structural_move_is_not_auto_fixed() -> None:
    # 구조상(heading level)으로는 "2. 문제 정의" 밑에 있지만 번호는 "1"을 가리키는 소주제 — AI가
    # "2-2"로 추측해서 자동수정하면 안 되고, 사람이 확인해야 하는 ambiguous로 표시해야 한다.
    doc = "# 1. 개요\n## 1-1. 목적\n# 2. 문제 정의\n## 2-1. 현황\n## 1-2. 범위"
    issues = validate_numbering(doc)
    assert len(issues) == 1

    ambiguous = issues[0]
    assert ambiguous.before_text == "1-2. 범위"
    assert ambiguous.status == "confirm"
    assert ambiguous.sub_type == "ambiguous"
    assert ambiguous.after_text is None
    assert ambiguous.location == "2. 문제 정의 > 1-2. 범위"
