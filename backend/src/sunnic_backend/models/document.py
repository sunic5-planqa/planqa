from pydantic import BaseModel


class Sentence(BaseModel):
    id: str
    text: str
    start: int
    end: int


class Paragraph(BaseModel):
    id: str
    sentences: list[Sentence]
    start: int
    end: int


class Chapter(BaseModel):
    id: str
    title: str
    paragraphs: list[Paragraph]
    start: int
    end: int


class ParsedStructure(BaseModel):
    title: str | None
    chapters: list[Chapter]


class Document(BaseModel):
    id: str
    raw_text: str
    working_text: str
    parsed_structure: ParsedStructure
    # Confluence's own page id (from the URL, e.g. /pages/{id}) — the extension's identity for
    # "this document" across sessions, unlike `id` which is a fresh UUID per POST /documents.
    # Set later via PATCH /documents/{id}/qa-status, not at creation time (a page isn't
    # necessarily under review yet when the document is first parsed).
    confluence_page_id: str | None = None
    qa_passed: bool = False
