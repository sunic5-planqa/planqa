import re
import uuid
from collections import Counter, defaultdict
from dataclasses import dataclass

from sunnic_backend.models.numbering_issue import NumberingIssue

# review_agent/document.py의 헤딩 정규식(#{2,6})과 동일한 전제를 쓴다 — h1은 문서 제목 전용이고
# h2~h6이 실제 섹션 헤딩이라는 구조는 이미 문서 파서가 신뢰하는 값이라 여기서도 그대로 따른다.
# 이 모듈은 review_agent/parse_document를 호출하지 않는 완전히 독립된 규칙 기반 검사기다 — AI QA
# 판단 영역(리뷰 파이프라인)과 넘버링 검증을 섞지 않기 위함.
_HEADING_RE = re.compile(r"(?m)^(#{2,6})[ \t]+(.+?)[ \t]*$")

# extension/src/utils/locationLabel.ts의 LEADING_NUMBER_RE와 동일한 조건: 숫자 뒤에 "."이나 공백이
# 바로 이어질 때만 "번호"로 인정한다("2024년 정책"의 "2024"를 번호로 오인하지 않기 위함).
_NUMBER_RE = re.compile(r"^\s*(\d+(?:[-.]\d+)*)[.\s]+")

# 번호 문자열에서 마지막 세그먼트 앞까지(dot-prefix)와 마지막 세그먼트를 분리한다. 구분자(.,-)는
# 원문에 쓰인 걸 그대로 보존해 부모 번호 문자열과 있는 그대로 비교할 수 있게 한다.
_SEGMENT_SPLIT_RE = re.compile(r"^(.*)[-.](\d+)$")


@dataclass(eq=False)
class _Heading:
    order: int
    level: int
    text: str
    number: str | None
    parent: "_Heading | None"


def _parse_headings(raw_text: str) -> list[_Heading]:
    headings: list[_Heading] = []
    stack: list[_Heading] = []
    for order, match in enumerate(_HEADING_RE.finditer(raw_text)):
        level = len(match.group(1))
        text = match.group(2).strip()
        number_match = _NUMBER_RE.match(text)
        number = number_match.group(1) if number_match else None
        while stack and stack[-1].level >= level:
            stack.pop()
        parent = stack[-1] if stack else None
        heading = _Heading(order=order, level=level, text=text, number=number, parent=parent)
        stack.append(heading)
        headings.append(heading)
    return headings


def _dot_prefix_and_last(number: str) -> tuple[str, int]:
    match = _SEGMENT_SPLIT_RE.match(number)
    if match:
        return match.group(1), int(match.group(2))
    return "", int(number)


def _location(heading: _Heading) -> str:
    chain: list[str] = []
    node: _Heading | None = heading
    while node is not None:
        chain.append(node.text)
        node = node.parent
    return " > ".join(reversed(chain))


def _replace_number(text: str, new_number: str) -> str:
    match = _NUMBER_RE.match(text)
    assert match is not None
    start, end = match.span(1)
    return text[:start] + new_number + text[end:]


def validate_numbering(raw_text: str) -> list[NumberingIssue]:
    headings = _parse_headings(raw_text)
    numbered = [h for h in headings if h.number is not None]

    ambiguous_ids: set[int] = set()
    for h in numbered:
        assert h.number is not None
        dot_prefix, _ = _dot_prefix_and_last(h.number)
        parent_number = h.parent.number if h.parent is not None else None
        if parent_number is None:
            continue
        if dot_prefix != parent_number:
            ambiguous_ids.add(id(h))

    groups: dict[int, list[_Heading]] = defaultdict(list)
    for h in numbered:
        if id(h) in ambiguous_ids:
            continue
        group_key = id(h.parent) if h.parent is not None else 0
        groups[group_key].append(h)

    results: list[tuple[int, NumberingIssue]] = []

    for h in numbered:
        if id(h) not in ambiguous_ids:
            continue
        results.append(
            (
                h.order,
                NumberingIssue(
                    id=str(uuid.uuid4()),
                    status="confirm",
                    sub_type="ambiguous",
                    location=_location(h),
                    problem="계층 구조 불명확",
                    before_text=h.text,
                    after_text=None,
                ),
            )
        )

    for siblings in groups.values():
        parent_number = siblings[0].parent.number if siblings[0].parent is not None else None
        actual_values = [_dot_prefix_and_last(h.number)[1] for h in siblings if h.number is not None]
        counts = Counter(actual_values)
        actual_set = set(actual_values)
        for index, h in enumerate(siblings):
            expected_value = index + 1
            actual_value = actual_values[index]
            if actual_value == expected_value:
                continue
            expected_number = f"{parent_number}.{expected_value}" if parent_number else str(expected_value)
            if counts[actual_value] > 1:
                sub_type, problem = "duplicate", "번호 중복"
            elif expected_value not in actual_set:
                sub_type, problem = "missing", "번호 누락"
            else:
                sub_type, problem = "order", "번호 순서 오류"
            results.append(
                (
                    h.order,
                    NumberingIssue(
                        id=str(uuid.uuid4()),
                        status="auto",
                        sub_type=sub_type,
                        location=_location(h),
                        problem=problem,
                        before_text=h.text,
                        after_text=_replace_number(h.text, expected_number),
                    ),
                )
            )

    results.sort(key=lambda pair: pair[0])
    return [issue for _order, issue in results]
