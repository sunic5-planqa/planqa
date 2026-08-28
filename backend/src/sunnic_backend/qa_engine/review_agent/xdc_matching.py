from __future__ import annotations

from dataclasses import dataclass

from sunnic_backend.qa_engine.review_agent.document import Chunk

_MIN_LEN_FOR_BIGRAM = 2
_WHITESPACE_TABLE = str.maketrans("", "", " \t\n\r")


def _normalize(text: str) -> str:
    # 구두점까지 지우면 "15%"와 "15"처럼 실제로 다른 정책값이 더 비슷해 보이는 역효과가 있어
    # 공백 제거만 한다.
    return text.translate(_WHITESPACE_TABLE)


def _char_bigrams(text: str) -> frozenset[str]:
    normalized = _normalize(text)
    if len(normalized) < _MIN_LEN_FOR_BIGRAM:
        return frozenset({normalized}) if normalized else frozenset()
    return frozenset(normalized[i : i + 2] for i in range(len(normalized) - 1))


def jaccard_similarity(text_a: str, text_b: str) -> float:
    bigrams_a = _char_bigrams(text_a)
    bigrams_b = _char_bigrams(text_b)
    if not bigrams_a or not bigrams_b:
        return 0.0
    intersection = len(bigrams_a & bigrams_b)
    union = len(bigrams_a | bigrams_b)
    return intersection / union if union else 0.0


@dataclass(frozen=True, slots=True)
class ReferenceSentence:
    # 여러 참고문서를 동시에 비교 대상으로 삼을 수 있어 문장 텍스트만으로는 출처를 알 수 없다.
    doc_id: str
    chunk: Chunk


@dataclass(frozen=True, slots=True)
class CandidatePair:
    current: Chunk
    reference: ReferenceSentence
    score: float


def top_candidate_pairs(
    current_sentences: list[Chunk],
    reference_sentences: list[ReferenceSentence],
    *,
    top_k: int = 3,
    min_score: float = 0.15,
) -> list[CandidatePair]:
    # rulebook_xdc.md §1-3: 세부값이 달라 점수가 낮아도 후보에서 제외하지 않는다는 원칙 때문에
    # min_score는 완전 무관한 문장만 거르는 낮은 문턱으로만 쓴다. 실제 판정은 2차 Sonnet이 한다.
    pairs: list[CandidatePair] = []
    for current in current_sentences:
        scored = (
            CandidatePair(current=current, reference=ref, score=jaccard_similarity(current.text, ref.chunk.text))
            for ref in reference_sentences
        )
        top = sorted((p for p in scored if p.score >= min_score), key=lambda p: p.score, reverse=True)[:top_k]
        pairs.extend(top)
    return pairs
