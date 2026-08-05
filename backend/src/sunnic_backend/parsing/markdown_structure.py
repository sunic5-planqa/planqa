import re
from itertools import pairwise

from sunnic_backend.models.document import Chapter, Paragraph, ParsedStructure, Sentence

_TITLE_RE = re.compile(r"^#(?!#)[ \t]+(.*)$", re.MULTILINE)
_CHAPTER_RE = re.compile(r"^##(?!#)[ \t]+(.*)$", re.MULTILINE)
_SENTENCE_END_RE = re.compile(r"[.!?]+(?=\s|$)")
_LIST_MARKER_RE = re.compile(r"\s*\d+[.)]+\s*")
_LIST_ITEM_RE = re.compile(r"(?m)^[ \t]*\d+[.)][ \t]+")

_UNCATEGORIZED_TITLE = "미분류"


def parse_markdown(raw_text: str) -> ParsedStructure:
    title: str | None = None
    content_start = 0

    title_match = _TITLE_RE.match(raw_text)
    if title_match:
        title = title_match.group(1).strip()
        content_start = title_match.end()
        if content_start < len(raw_text) and raw_text[content_start] == "\n":
            content_start += 1

    chapter_matches = [m for m in _CHAPTER_RE.finditer(raw_text) if m.start() >= content_start]

    chapters: list[Chapter] = []

    if not chapter_matches:
        if raw_text[content_start:].strip():
            chapters.append(
                _build_chapter("1", _UNCATEGORIZED_TITLE, content_start, len(raw_text), raw_text)
            )
        return ParsedStructure(title=title, chapters=chapters)

    first_start = chapter_matches[0].start()
    if raw_text[content_start:first_start].strip():
        chapters.append(_build_chapter("1", _UNCATEGORIZED_TITLE, content_start, first_start, raw_text))

    for idx, match in enumerate(chapter_matches):
        chapter_title = match.group(1).strip()
        block_start = match.start()
        block_end = chapter_matches[idx + 1].start() if idx + 1 < len(chapter_matches) else len(raw_text)
        paragraph_start = match.end()
        if paragraph_start < len(raw_text) and raw_text[paragraph_start] == "\n":
            paragraph_start += 1
        chapter_id = str(len(chapters) + 1)
        chapters.append(
            _build_chapter(chapter_id, chapter_title, block_start, block_end, raw_text, paragraph_start)
        )

    return ParsedStructure(title=title, chapters=chapters)


def _build_chapter(
    chapter_id: str,
    title: str,
    start: int,
    end: int,
    raw_text: str,
    paragraph_start: int | None = None,
) -> Chapter:
    content_start = paragraph_start if paragraph_start is not None else start
    paragraphs = [
        _build_paragraph(f"{chapter_id}.{idx + 1}", p_start, p_end, raw_text)
        for idx, (p_start, p_end) in enumerate(_find_paragraph_spans(content_start, end, raw_text))
    ]
    return Chapter(id=chapter_id, title=title, paragraphs=paragraphs, start=start, end=end)


def _build_paragraph(paragraph_id: str, start: int, end: int, raw_text: str) -> Paragraph:
    text = raw_text[start:end]
    sentences = [
        Sentence(id=f"{paragraph_id}.{idx + 1}", text=raw_text[s_start:s_end], start=s_start, end=s_end)
        for idx, (s_start, s_end) in enumerate(_find_sentence_spans(text, offset=start))
    ]
    return Paragraph(id=paragraph_id, sentences=sentences, start=start, end=end)


def _find_paragraph_spans(content_start: int, end: int, raw_text: str) -> list[tuple[int, int]]:
    spans: list[tuple[int, int]] = []
    para_start: int | None = None
    para_end: int | None = None
    pos = content_start

    for line in raw_text[content_start:end].splitlines(keepends=True):
        stripped = line.strip()
        if stripped:
            if para_start is None:
                para_start = pos
            para_end = pos + len(line.rstrip("\n"))
        elif para_start is not None:
            spans.append((para_start, para_end))
            para_start = None
            para_end = None
        pos += len(line)

    if para_start is not None:
        spans.append((para_start, para_end))

    return spans


def _find_sentence_spans(text: str, offset: int) -> list[tuple[int, int]]:
    # Numbered-list items are segmented first so a later item's marker (e.g. "2.")
    # never gets glued onto the previous item's sentence as its terminator.
    boundaries = sorted({0, *(m.start() for m in _LIST_ITEM_RE.finditer(text)), len(text)})

    spans: list[tuple[int, int]] = []
    for seg_start, seg_end in pairwise(boundaries):
        segment = text[seg_start:seg_end]
        for s, e in _split_segment_sentences(segment):
            spans.append((offset + seg_start + s, offset + seg_start + e))

    return spans


def _split_segment_sentences(segment: str) -> list[tuple[int, int]]:
    spans: list[tuple[int, int]] = []
    last = 0

    for match in _SENTENCE_END_RE.finditer(segment):
        end = match.end()
        candidate = segment[last:end]
        if _LIST_MARKER_RE.fullmatch(candidate):
            continue
        if candidate.strip():
            spans.append(_strip_span(candidate, last))
        last = end

    remainder = segment[last:]
    if remainder.strip():
        spans.append(_strip_span(remainder, last))

    return spans


def _strip_span(segment: str, base: int) -> tuple[int, int]:
    lstripped = segment.lstrip()
    leading = len(segment) - len(lstripped)
    stripped = lstripped.rstrip()
    return base + leading, base + leading + len(stripped)
