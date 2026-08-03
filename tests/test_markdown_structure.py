from sunnic_backend.parsing.markdown_structure import parse_markdown


def test_title_and_chapters_are_parsed() -> None:
    raw = "# 기획서 제목\n\n## 배경\n\n배경 설명입니다. 두번째 문장입니다.\n\n## 목표\n\n목표 설명입니다."

    structure = parse_markdown(raw)

    assert structure.title == "기획서 제목"
    assert [c.title for c in structure.chapters] == ["배경", "목표"]


def test_offsets_round_trip_against_raw_text() -> None:
    raw = "# 제목\n\n## 챕터1\n\n첫 문단입니다. 두번째 문장.\n\n두번째 문단입니다."

    structure = parse_markdown(raw)

    chapter = structure.chapters[0]
    assert raw[chapter.start : chapter.end].strip().startswith("## 챕터1")

    for paragraph in chapter.paragraphs:
        for sentence in paragraph.sentences:
            assert raw[sentence.start : sentence.end] == sentence.text
            assert paragraph.start <= sentence.start <= sentence.end <= paragraph.end


def test_content_before_first_chapter_becomes_uncategorized() -> None:
    raw = "# 제목\n\n헤더 없이 바로 나온 내용.\n\n## 진짜챕터\n\n내용."

    structure = parse_markdown(raw)

    assert structure.chapters[0].title == "미분류"
    assert structure.chapters[1].title == "진짜챕터"


def test_no_chapters_creates_single_uncategorized_chapter() -> None:
    raw = "그냥 문단 하나만 있는 텍스트입니다."

    structure = parse_markdown(raw)

    assert len(structure.chapters) == 1
    assert structure.chapters[0].title == "미분류"
    assert len(structure.chapters[0].paragraphs) == 1


def test_numbered_list_marker_does_not_split_sentence() -> None:
    raw = "## 챕터\n\n1. 첫번째 항목입니다."

    structure = parse_markdown(raw)

    sentences = structure.chapters[0].paragraphs[0].sentences
    assert len(sentences) == 1
    assert sentences[0].text == "1. 첫번째 항목입니다."


def test_decimal_number_does_not_split_sentence() -> None:
    raw = "## 챕터\n\n버전 3.5가 출시되었습니다."

    structure = parse_markdown(raw)

    sentences = structure.chapters[0].paragraphs[0].sentences
    assert len(sentences) == 1
    assert "3.5" in sentences[0].text


def test_multi_item_numbered_list_splits_per_item() -> None:
    raw = "## 챕터\n\n1. 문서 구조 파싱\n2. 계층별 QA 검증"

    structure = parse_markdown(raw)

    sentences = structure.chapters[0].paragraphs[0].sentences
    assert [s.text for s in sentences] == ["1. 문서 구조 파싱", "2. 계층별 QA 검증"]
    for sentence in sentences:
        assert raw[sentence.start : sentence.end] == sentence.text


def test_no_title_no_chapters_returns_none_title() -> None:
    raw = "## 챕터만\n\n내용."

    structure = parse_markdown(raw)

    assert structure.title is None
    assert structure.chapters[0].title == "챕터만"
