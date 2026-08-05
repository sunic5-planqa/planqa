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
