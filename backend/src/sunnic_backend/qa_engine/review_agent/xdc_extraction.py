from __future__ import annotations

from sunnic_backend.qa_engine.review_agent.document import Chunk, DocumentTree, parse_document
from sunnic_backend.qa_engine.review_agent.llm.base import LLMClient
from sunnic_backend.qa_engine.review_agent.planqa_schemas.schema import Level
from sunnic_backend.qa_engine.review_agent.xdc_matching import ReferenceSentence

_REFERENCE_EXTRACT_SYSTEM = (
    "You are extracting CONFIRMED decisions from a service planning document that will be "
    "used as a reference/answer-key for comparison against another document. Extract only "
    "sentences that state a fixed, decided value — amounts, rates, quantities, limits; "
    "deadlines, periods, timing; scope of application (region, user group, product, channel); "
    "possible/impossible outcomes and processing results; explicitly stated changes "
    "(e.g. 'expanded from X to Y'). Do NOT extract problem definitions, background, ideas, "
    "KPIs, or general explanations.\n"
    'Respond with JSON only: {"statements": ["<exact sentence from the text>", ...]}'
)

_CURRENT_EXTRACT_SYSTEM = (
    "You are extracting POLICY statements from a service planning document that will be "
    "compared against separate reference documents for consistency. Extract only sentences "
    "that state a policy value comparable to a reference document — the same categories as "
    "a reference extraction (amounts/rates, periods/deadlines, scope of application, "
    "possible/impossible outcomes, explicitly stated changes). Do NOT extract problem "
    "definitions, background, ideas, KPIs, or general explanations.\n"
    'Respond with JSON only: {"statements": ["<exact sentence from the text>", ...]}'
)


def _extract_statements(unit_text: str, system: str, llm: LLMClient) -> list[str]:
    try:
        response = llm.complete_json(system=system, prompt=unit_text)
    except Exception:  # noqa: BLE001 - 추출 실패가 전체 QA 파이프라인을 죽이면 안 된다
        return []
    if not isinstance(response, dict):
        return []
    statements = response.get("statements", [])
    if not isinstance(statements, list):
        return []
    return [s for s in statements if isinstance(s, str) and s.strip()]


def _statement_chunks(tree: DocumentTree, system: str, llm: LLMClient) -> list[Chunk]:
    chunks: list[Chunk] = []
    for unit in tree.logical_units:
        for statement in _extract_statements(unit.text, system, llm):
            chunks.append(Chunk(level=Level.SENTENCE, location=unit.location, text=statement))
    return chunks


def extract_confirmed_statements(doc_id: str, document_text: str, llm: LLMClient) -> list[Chunk]:
    tree = parse_document(doc_id, document_text)
    return _statement_chunks(tree, _CURRENT_EXTRACT_SYSTEM, llm)


def extract_reference_statements(doc_id: str, document_text: str, llm: LLMClient) -> list[ReferenceSentence]:
    tree = parse_document(doc_id, document_text)
    chunks = _statement_chunks(tree, _REFERENCE_EXTRACT_SYSTEM, llm)
    return [ReferenceSentence(doc_id=doc_id, chunk=chunk) for chunk in chunks]
