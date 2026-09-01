"""Deterministic, rule-based numbering validation for author-written heading numbers.

이 모듈은 review_agent/parse_document를 호출하지 않는 완전히 독립된 규칙 기반 검사기다 — AI QA
판단 영역(리뷰 파이프라인)과 넘버링 검증을 섞지 않기 위함이며, LLM/문맥 추론/사용자 의도 추측을
전혀 쓰지 않는다. 판단 기준은 오직 두 가지: (1) Markdown heading의 실제 계층(# 개수), (2) heading에
실제로 작성된 번호.

파이프라인은 다음 순서로 명확히 분리되어 있고, 각 단계는 아래 동명의 함수/헬퍼에 대응한다:

    raw_text
      -> _parse_headings()       STEP 1: heading 추출 + "구조적 부모" 연결(heading level만 사용)
      -> _parse_number()         STEP 1b: 각 heading의 번호를 파싱(값과 표시 형식을 분리해서 보관)
      -> _is_ambiguous()         STEP 2: 구조적 부모의 번호 vs 자기 번호의 dot-prefix 비교
      -> group by structural parent   STEP 3: "번호 오류" 검사 대상(형제 그룹) 확정 — 모호 판정된
                                       heading은 이 단계에서 제외되어 자동수정 후보에 안 들어간다.
      -> _check_sibling_group()  STEP 4: 그룹 내 등장 순서(1부터) vs 실제 번호 비교 ->
                                 missing/duplicate/order 판정 + before/after_text 생성

구조적 부모(structural_parent)와 "번호가 가리키는 부모"는 절대 같은 것으로 취급하지 않는다 —
전자는 heading level로만 정해지는 사실이고, 후자는 그 사실과 비교당하는 대상이다. 이 둘이 다르면
(예: 소주제를 다른 대주제 밑으로 옮겼지만 번호는 그대로 둔 경우) 어느 쪽이 "맞다"고 추측하지 않고
ambiguous로 표시해 사람이 결정하게 한다.
"""

import re
import uuid
from collections import Counter, defaultdict
from dataclasses import dataclass

from sunnic_backend.models.numbering_issue import NumberingIssue

# review_agent/document.py는 h1을 "문서 제목 전용"으로 보고 h2~h6만 실제 섹션 헤딩으로 다루지만,
# 그 전제는 넘버링 검증에는 맞지 않는다 — 실제 문서에서 h1이 "1. 혜택 알림 운영 개요"처럼 번호가
# 매겨진 대주제로, h2가 그 아래 소주제("1-1")로 쓰인다. h1을 헤딩에서 빼면 서로 다른 대주제 밑의
# 소주제들이 구조적 부모 없이 하나의 그룹으로 뒤섞여 대량 오탐이 난다 — h1~h6을 전부 헤딩으로 본다.
_HEADING_RE = re.compile(r"(?m)^(#{1,6})[ \t]+(.+?)[ \t]*$")

# extension/src/utils/locationLabel.ts의 LEADING_NUMBER_RE와 동일한 조건: 숫자 뒤에 "."이나 공백이
# 바로 이어질 때만 "번호"로 인정한다("2024년 정책"의 "2024"를 번호로 오인하지 않기 위함).
_NUMBER_RE = re.compile(r"^\s*(\d+(?:[-.]\d+)*)[.\s]+")

# _format_number()가 원문의 구분자(., -)를 그대로 재사용하기 위해, 번호 문자열의 "마지막 세그먼트
# 앞까지(구분자 포함)"와 "마지막 세그먼트"를 나눈다.
_LAST_SEGMENT_RE = re.compile(r"^(.*[-.])(\d+)$")


# ---------------------------------------------------------------------------
# STEP 1b — Number parsing: 번호의 "값"과 "표시 형식"을 분리해서 보관한다.
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class _Number:
    raw: str  # 원문 그대로("1-2", "01", "2.3") — 자동수정 시 형식 재사용에 쓴다.
    parts: tuple[int, ...]  # 0 패딩 무시한 정수 세그먼트("01"과 "1"은 둘 다 (1,)) — 비교에만 쓴다.

    @property
    def prefix_parts(self) -> tuple[int, ...]:
        """마지막 세그먼트를 뺀 나머지 — 구조적 부모의 번호와 비교할 부분."""
        return self.parts[:-1]

    @property
    def last(self) -> int:
        """마지막 세그먼트 — 같은 형제 그룹 안에서의 순번 비교에 쓴다."""
        return self.parts[-1]


def _parse_number(heading_text: str) -> _Number | None:
    match = _NUMBER_RE.match(heading_text)
    if match is None:
        return None
    raw = match.group(1)
    parts = tuple(int(part) for part in re.split(r"[-.]", raw))
    return _Number(raw=raw, parts=parts)


def _format_number(original: _Number, new_last: int) -> str:
    """original과 같은 구분자/패딩 스타일을 유지한 채 마지막 세그먼트만 new_last로 바꾼다.
    부모 번호 문자열을 이어붙이지 않는다 — 대주제가 "01"(0 패딩)이고 소주제가 "1-1"(대시, 무패딩)
    처럼 레벨마다 표기 스타일이 다른 문서에서, 이미 맞다고 확인된 이 heading 자신의 형식을
    재사용해야 "01.3" 같은 엉뚱한 제안이 나가지 않는다."""
    if len(original.parts) == 1:
        return str(new_last)
    match = _LAST_SEGMENT_RE.match(original.raw)
    assert match is not None
    return f"{match.group(1)}{new_last}"


def _replace_number_span(heading_text: str, new_number: str) -> str:
    """heading_text에서 번호 capture span만 new_number로 치환한다 — 제목/공백/구두점 등 번호
    이외의 모든 문자는 원문 그대로 유지된다(문자열을 다시 조립하지 않는다)."""
    match = _NUMBER_RE.match(heading_text)
    assert match is not None
    start, end = match.span(1)
    return heading_text[:start] + new_number + heading_text[end:]


# ---------------------------------------------------------------------------
# STEP 1 — Heading parsing: 구조 트리는 오직 heading level(# 개수)로만 만든다.
# ---------------------------------------------------------------------------
@dataclass
class _Heading:
    order: int
    level: int
    title_text: str  # "#"를 뗀 heading 텍스트 전체, 원문 그대로(번호 포함)
    number: _Number | None
    structural_parent: "_Heading | None"


def _parse_headings(raw_text: str) -> list[_Heading]:
    headings: list[_Heading] = []
    stack: list[_Heading] = []
    for order, match in enumerate(_HEADING_RE.finditer(raw_text)):
        level = len(match.group(1))
        title_text = match.group(2).strip()
        while stack and stack[-1].level >= level:
            stack.pop()
        heading = _Heading(
            order=order,
            level=level,
            title_text=title_text,
            number=_parse_number(title_text),
            structural_parent=stack[-1] if stack else None,
        )
        stack.append(heading)
        headings.append(heading)
    return headings


def _location(heading: _Heading) -> str:
    chain: list[str] = []
    node: _Heading | None = heading
    while node is not None:
        chain.append(node.title_text)
        node = node.structural_parent
    return " > ".join(reversed(chain))


# ---------------------------------------------------------------------------
# STEP 2 — Ambiguity check: 구조적 부모의 번호 vs 이 heading 번호의 dot-prefix.
# ---------------------------------------------------------------------------
def _is_ambiguous(heading: _Heading) -> bool:
    """heading level로 정해진 "사실"(구조적 부모)과 저자가 실제로 적은 번호가 서로 다른 이야기를
    하면(예: 구조상 부모는 "2"인데 번호는 "1-3"처럼 "1"을 가리킴) 어느 쪽이 맞는지 추측하지 않고
    모호로 표시한다 — 사용자가 섹션을 옮기면서 번호를 안 바꿨을 수도, 번호 자체가 오타일 수도
    있어서 자동수정 대상에서 반드시 제외해야 한다."""
    assert heading.number is not None
    parent_number = heading.structural_parent.number if heading.structural_parent is not None else None
    if parent_number is None:
        # 최상위(대주제) heading이거나 부모 heading에 번호가 없으면 비교할 "번호가 가리키는 부모"
        # 자체가 없다 — 모호 판정 대상이 아니라 자기 형제 그룹(missing/duplicate/order)에서만 검사.
        return False
    return heading.number.prefix_parts != parent_number.parts


# ---------------------------------------------------------------------------
# STEP 3/4 — Sibling grouping + expected-number 비교.
# ---------------------------------------------------------------------------
def _group_key(heading: _Heading) -> int:
    """같은 구조적 부모를 가진 heading끼리만 하나의 numbering domain(형제 그룹)이 된다 — 대주제
    (부모 없음, key=0)와 각 대주제 밑 소주제(대주제마다 다른 key)는 절대 같은 배열로 섞이지 않는다."""
    return id(heading.structural_parent) if heading.structural_parent is not None else 0


def _check_sibling_group(siblings: list[_Heading]) -> list[tuple[int, NumberingIssue]]:
    """한 형제 그룹 안에서, 등장 순서(1부터: enumerate(siblings, start=1))를 expected 번호로 삼아
    실제 마지막 세그먼트 값과 비교한다. 판정은 "지금까지 본 값"이 아니라 그룹 전체 actual 값
    집합을 기준으로 한다 — 그래야 번호가 밀리며 연쇄적으로 어긋나는 뒤쪽 항목도 각자 독립적으로
    정확히 판정된다."""
    actual_values = [h.number.last for h in siblings if h.number is not None]
    counts = Counter(actual_values)
    actual_set = set(actual_values)

    results: list[tuple[int, NumberingIssue]] = []
    for index, h in enumerate(siblings, start=1):
        assert h.number is not None
        expected_value = index
        actual_value = h.number.last
        if actual_value == expected_value:
            continue

        if counts[actual_value] > 1:
            sub_type, problem = "duplicate", "번호 중복"
        elif expected_value not in actual_set:
            sub_type, problem = "missing", "번호 누락"
        else:
            sub_type, problem = "order", "번호 순서 오류"

        expected_number = _format_number(h.number, expected_value)
        results.append(
            (
                h.order,
                NumberingIssue(
                    id=str(uuid.uuid4()),
                    status="auto",
                    sub_type=sub_type,
                    location=_location(h),
                    problem=problem,
                    before_text=h.title_text,
                    after_text=_replace_number_span(h.title_text, expected_number),
                ),
            )
        )
    return results


def _ambiguous_issue(heading: _Heading) -> NumberingIssue:
    return NumberingIssue(
        id=str(uuid.uuid4()),
        status="confirm",
        sub_type="ambiguous",
        location=_location(heading),
        problem="계층 구조와 번호 체계가 일치하지 않습니다",
        before_text=heading.title_text,
        after_text=None,
    )


def validate_numbering(raw_text: str) -> list[NumberingIssue]:
    headings = _parse_headings(raw_text)
    numbered = [h for h in headings if h.number is not None]

    ambiguous_ids = {id(h) for h in numbered if _is_ambiguous(h)}

    groups: dict[int, list[_Heading]] = defaultdict(list)
    for h in numbered:
        if id(h) not in ambiguous_ids:
            groups[_group_key(h)].append(h)

    results: list[tuple[int, NumberingIssue]] = [
        (h.order, _ambiguous_issue(h)) for h in numbered if id(h) in ambiguous_ids
    ]
    for siblings in groups.values():
        results.extend(_check_sibling_group(siblings))

    results.sort(key=lambda pair: pair[0])
    return [issue for _order, issue in results]
