from __future__ import annotations

from typing import Any

import pytest

from sunnic_backend.qa_engine.review_agent.planqa_schemas.rulebook import parse_rulebook
from sunnic_backend.qa_engine.review_agent.planqa_schemas.schema import Issue, Level
from sunnic_backend.qa_engine.review_agent.structures import bundled_screen_hybrid
from sunnic_backend.qa_engine.review_agent.structures.bundled_screen_hybrid import (
    _run_concurrently,
    _verify_ae_finding,
    _verify_mi_finding,
    review_document,
)

from .conftest import ScriptedLLM

_DOC = "# 샘플 PRD\n\n## 1. 목적\n\n간단한 목적 설명입니다.\n\n## 2. 배경\n\n두번째 문단입니다.\n"

_EMPTY_CANDIDATES = {"candidates": []}


def test_review_document_gives_both_rule_text_and_fewshot_examples_in_both_stages(rulebook_path):
    rulebook = parse_rulebook(rulebook_path)
    confirm_llm = ScriptedLLM(
        [{"summary": ""}],
        keyed_responses={
            Level.PARAGRAPH: [
                {
                    "verdicts": [
                        {
                            "index": 0,
                            "violated": True,
                            "original_text": "간단한 목적 설명입니다.",
                            "description": "d",
                            "fix_direction": "f",
                            "excused": False,
                        }
                    ]
                }
            ],
        },
    )
    screen_llm = ScriptedLLM(
        keyed_responses={
            Level.PARAGRAPH: [
                {"candidates": [{"chunk_index": 0, "rule_id": "MI-01", "quoted_text": "간단한 목적 설명입니다.", "reason": "r"}]}
            ],
            Level.DOCUMENT: [_EMPTY_CANDIDATES],
        }
    )

    review_document("DOC-TEST", _DOC, rulebook, screen_llm, confirm_llm)

    mi01_rule = rulebook.rules["MI-01"]
    paragraph_screen = screen_llm.isolated[Level.PARAGRAPH]
    paragraph_confirm = confirm_llm.isolated[Level.PARAGRAPH]
    assert mi01_rule.text in paragraph_screen.calls[0]["prompt"]
    assert mi01_rule.text in paragraph_confirm.calls[0]["prompt"]


def test_review_document_two_passes_end_to_end(rulebook_path):
    rulebook = parse_rulebook(rulebook_path)
    confirm_llm = ScriptedLLM(
        [{"summary": "이 문서는 홈 화면의 목적을 설명한다."}],
        keyed_responses={
            Level.PARAGRAPH: [
                {
                    "verdicts": [
                        {
                            "index": 0,
                            "violated": True,
                            "original_text": "간단한 목적 설명입니다.",
                            "description": "목적이 구체적이지 않음",
                            "fix_direction": "목적을 구체화할 것",
                            "excused": False,
                        }
                    ]
                }
            ],
        },
    )
    screen_llm = ScriptedLLM(
        keyed_responses={
            Level.PARAGRAPH: [
                {
                    "candidates": [
                        {"chunk_index": 0, "rule_id": "MI-01", "quoted_text": "간단한 목적 설명입니다.", "reason": "불명확"}
                    ]
                }
            ],
            Level.DOCUMENT: [_EMPTY_CANDIDATES],
        }
    )

    result = review_document("DOC-TEST", _DOC, rulebook, screen_llm, confirm_llm)

    assert result.global_context == "이 문서는 홈 화면의 목적을 설명한다."
    [issue] = result.issues
    assert issue.rule_id == "MI-01"
    assert issue.level == "Paragraph"


def test_review_document_keeps_the_issue_when_model_sends_string_indices(rulebook_path):
    # Regression test: Anthropic always echoed chunk_index/index as a JSON int, but OpenAI
    # (the live confirm_llm/screen_llm backend as of this test) has been seen sending the
    # same fields as numeric strings instead — a strict isinstance(..., int)/dict-by-int-key
    # lookup then silently drops every candidate/verdict with no exception, so the job
    # "succeeds" with zero issues. Both fields are strings here to prove the whole pipeline
    # (not just one coercion site) survives it end to end.
    rulebook = parse_rulebook(rulebook_path)
    confirm_llm = ScriptedLLM(
        [{"summary": ""}],
        keyed_responses={
            Level.PARAGRAPH: [
                {
                    "verdicts": [
                        {
                            "index": "0",
                            "violated": True,
                            "original_text": "간단한 목적 설명입니다.",
                            "description": "d",
                            "fix_direction": "f",
                            "excused": False,
                        }
                    ]
                }
            ],
        },
    )
    screen_llm = ScriptedLLM(
        keyed_responses={
            Level.PARAGRAPH: [
                {"candidates": [{"chunk_index": "0", "rule_id": "MI-01", "quoted_text": "간단한 목적 설명입니다.", "reason": "r"}]}
            ],
            Level.DOCUMENT: [_EMPTY_CANDIDATES],
        }
    )

    result = review_document("DOC-TEST", _DOC, rulebook, screen_llm, confirm_llm)

    assert result.tier_errors == ()
    [issue] = result.issues
    assert issue.rule_id == "MI-01"


def test_review_document_ignores_related_fields_for_non_relational_categories(rulebook_path):
    # MI isn't in _RELATIONAL_CATEGORIES — even if the model tries to fill
    # related_location/related_original_text anyway (defensive against it ignoring the
    # null instruction), both must come back None.
    rulebook = parse_rulebook(rulebook_path)
    confirm_llm = ScriptedLLM(
        [{"summary": ""}],
        keyed_responses={
            Level.PARAGRAPH: [
                {
                    "verdicts": [
                        {
                            "index": 0,
                            "violated": True,
                            "original_text": "x",
                            "description": "d",
                            "fix_direction": "f",
                            "excused": False,
                            "related_location": "이건 무시돼야 함",
                            "related_original_text": "이것도 무시돼야 함",
                        }
                    ]
                }
            ],
        },
    )
    screen_llm = ScriptedLLM(
        keyed_responses={
            Level.PARAGRAPH: [
                {"candidates": [{"chunk_index": 0, "rule_id": "MI-01", "quoted_text": "x", "reason": "r"}]}
            ],
            Level.DOCUMENT: [_EMPTY_CANDIDATES],
        }
    )

    result = review_document("DOC-TEST", _DOC, rulebook, screen_llm, confirm_llm)

    [issue] = result.issues
    assert issue.related_location is None
    assert issue.related_original_text is None


def test_review_document_respects_excused_flag(rulebook_path):
    rulebook = parse_rulebook(rulebook_path)
    confirm_llm = ScriptedLLM(
        [{"summary": ""}],
        keyed_responses={
            Level.PARAGRAPH: [
                {
                    "verdicts": [
                        {
                            "index": 0,
                            "violated": True,
                            "original_text": "x",
                            "description": "d",
                            "fix_direction": "f",
                            "excused": True,
                            "excuse_reason": "예외 적용",
                        }
                    ]
                }
            ],
        },
    )
    screen_llm = ScriptedLLM(
        keyed_responses={
            Level.PARAGRAPH: [
                {"candidates": [{"chunk_index": 0, "rule_id": "MI-01", "quoted_text": "x", "reason": "r"}]}
            ],
            Level.DOCUMENT: [_EMPTY_CANDIDATES],
        }
    )

    result = review_document("DOC-TEST", _DOC, rulebook, screen_llm, confirm_llm)
    assert result.issues == ()


def test_review_document_dispatches_ga_at_document_level_only(rulebook_path):
    rulebook = parse_rulebook(rulebook_path)
    confirm_llm = ScriptedLLM(
        [{"summary": ""}],
        keyed_responses={
            Level.DOCUMENT: [
                {
                    "verdicts": [
                        {
                            "index": 0,
                            "violated": True,
                            "original_text": "x",
                            "description": "d",
                            "fix_direction": "f",
                            "excused": False,
                        }
                    ]
                }
            ],
        },
    )
    screen_llm = ScriptedLLM(
        keyed_responses={
            Level.PARAGRAPH: [_EMPTY_CANDIDATES],
            Level.DOCUMENT: [
                {"candidates": [{"chunk_index": 0, "rule_id": "GA-01", "quoted_text": "x", "reason": "r"}]}
            ],
        }
    )

    result = review_document("DOC-TEST", _DOC, rulebook, screen_llm, confirm_llm)

    [issue] = result.issues
    assert issue.rule_id == "GA-01"
    assert issue.level == "Document"


def test_review_document_dispatches_lg_and_lf_at_document_level_too(rulebook_path):
    # LG/LF are relational categories (_RELATIONAL_CATEGORIES) just like GA — they're
    # defined as conflicts between two distant locations, so (2026-08-10 보완) they need
    # the same whole-document visibility GA already had, not a per-paragraph chunk.
    rulebook = parse_rulebook(rulebook_path)
    confirm_llm = ScriptedLLM(
        [{"summary": ""}],
        keyed_responses={
            Level.DOCUMENT: [
                {
                    "verdicts": [
                        {
                            "index": 0,
                            "violated": True,
                            "original_text": "x",
                            "description": "d",
                            "fix_direction": "f",
                            "excused": False,
                            "related_location": "다른 위치",
                            "related_original_text": "다른 위치의 원문 문장",
                        }
                    ]
                }
            ],
        },
    )
    screen_llm = ScriptedLLM(
        keyed_responses={
            Level.PARAGRAPH: [_EMPTY_CANDIDATES],
            Level.DOCUMENT: [
                {"candidates": [{"chunk_index": 0, "rule_id": "LG-02", "quoted_text": "x", "reason": "r"}]}
            ],
        }
    )

    result = review_document("DOC-TEST", _DOC, rulebook, screen_llm, confirm_llm)

    [issue] = result.issues
    assert issue.rule_id == "LG-02"
    assert issue.level == "Document"
    assert issue.related_location == "다른 위치"
    assert issue.related_original_text == "다른 위치의 원문 문장"


def test_screen_and_confirm_prompts_instruct_active_cross_location_search(rulebook_path):
    rulebook = parse_rulebook(rulebook_path)
    confirm_llm = ScriptedLLM(
        [{"summary": ""}],
        keyed_responses={Level.DOCUMENT: [{"verdicts": [{"index": 0, "violated": False}]}]},
    )
    screen_llm = ScriptedLLM(
        keyed_responses={
            Level.PARAGRAPH: [_EMPTY_CANDIDATES],
            Level.DOCUMENT: [
                {"candidates": [{"chunk_index": 0, "rule_id": "GA-01", "quoted_text": "x", "reason": "r"}]}
            ],
        }
    )

    review_document("DOC-TEST", _DOC, rulebook, screen_llm, confirm_llm)

    screen_system = screen_llm.isolated[Level.DOCUMENT].calls[-1]["system"]
    confirm_system = confirm_llm.isolated[Level.DOCUMENT].calls[-1]["system"]
    assert "goal/KPI" in screen_system
    assert "actively search" in confirm_system


def test_review_document_reports_a_clear_error_if_a_plain_scripted_llm_is_used(rulebook_path):
    # A plain ScriptedLLM([...]) (no keyed_responses) used against a structure that
    # dispatches concurrently must fail with a clear, specific message in tier_errors —
    # never silently reintroduce the shared-iterator race keyed_responses exists to
    # prevent. isolate_client() failures degrade into a tier_error like any other pass
    # failure (review_document itself must not crash), so this checks the error message
    # landed there rather than propagating as a raised exception.
    rulebook = parse_rulebook(rulebook_path)
    confirm_llm = ScriptedLLM([{"summary": ""}])
    screen_llm = ScriptedLLM([_EMPTY_CANDIDATES, _EMPTY_CANDIDATES])

    result = review_document("DOC-TEST", _DOC, rulebook, screen_llm, confirm_llm)

    assert any("keyed_responses" in error for error in result.tier_errors)


class _StubVerifyLLM:
    """A minimal LLMClient double for unit-testing _verify_mi_finding/_verify_ae_finding in
    isolation, without needing a full ScriptedLLM response queue — mirrors planqa-agent's
    services/review-agent _StubVerifyLLM (2026-08-21, MI/AE 과탐지 검증 완화)."""

    def __init__(self, response: Any | None, *, raise_error: bool = False) -> None:
        self._response = response
        self._raise_error = raise_error

    def complete_json(self, *, system: str, prompt: str, cache_prefix: str | None = None) -> Any:
        if self._raise_error:
            raise RuntimeError("boom")
        return self._response


def _mi_issue(**overrides) -> Issue:
    defaults = {
        "doc_id": "DOC-TEST",
        "level": "Paragraph",
        "rule_id": "MI-01",
        "location": "8. 런칭 계획",
        "description": "런칭일/QA 기간이 구체적으로 명시되지 않음",
        "original_text": "목표 런칭일: - QA 기간: ~",
        "rationale": "시간 조건이 정의되지 않음",
    }
    defaults.update(overrides)
    return Issue(**defaults)


def _ae_issue(**overrides) -> Issue:
    defaults = {
        "doc_id": "DOC-TEST",
        "level": "Paragraph",
        "rule_id": "AE-03",
        "location": "4. 처리 정책",
        "description": "판단 기준이 불명확함",
        "original_text": "적당한 기간 내에 처리한다",
        "rationale": "구체적 기준이 없음",
    }
    defaults.update(overrides)
    return Issue(**defaults)


def test_verify_mi_finding_keeps_the_issue_when_verification_confirms_it_is_missing():
    llm = _StubVerifyLLM({"actually_missing": True, "reason": "정말 없음"})
    assert _verify_mi_finding("문서 전문", _mi_issue(), llm) is True


def test_verify_mi_finding_drops_the_issue_when_verification_finds_it_present():
    llm = _StubVerifyLLM({"actually_missing": False, "reason": "8장에 날짜가 있음"})
    assert _verify_mi_finding("문서 전문", _mi_issue(), llm) is False


def test_verify_mi_finding_fails_safe_by_keeping_the_issue_on_llm_error():
    llm = _StubVerifyLLM(None, raise_error=True)
    assert _verify_mi_finding("문서 전문", _mi_issue(), llm) is True


def test_verify_mi_finding_fails_safe_on_malformed_response():
    llm = _StubVerifyLLM("not a dict")
    assert _verify_mi_finding("문서 전문", _mi_issue(), llm) is True


def test_verify_ae_finding_keeps_the_issue_when_verification_confirms_it_is_ambiguous():
    llm = _StubVerifyLLM({"actually_ambiguous": True, "reason": "정말 모호함"})
    assert _verify_ae_finding("문서 전문", _ae_issue(), llm) is True


def test_verify_ae_finding_drops_the_issue_when_verification_finds_it_defined_elsewhere():
    llm = _StubVerifyLLM({"actually_ambiguous": False, "reason": "3장에 기준이 정의돼 있음"})
    assert _verify_ae_finding("문서 전문", _ae_issue(), llm) is False


def test_verify_ae_finding_fails_safe_by_keeping_the_issue_on_llm_error():
    llm = _StubVerifyLLM(None, raise_error=True)
    assert _verify_ae_finding("문서 전문", _ae_issue(), llm) is True


def test_verify_ae_finding_fails_safe_on_malformed_response():
    llm = _StubVerifyLLM("not a dict")
    assert _verify_ae_finding("문서 전문", _ae_issue(), llm) is True


def test_review_document_drops_an_mi_finding_the_fp_verifier_rejects(rulebook_path):
    # End-to-end: a screened+confirmed MI candidate that _verify_mi_finding then rejects
    # must not appear in the final issues — proves the verification stage is actually wired
    # into review_document(), not just unit-tested in isolation above.
    rulebook = parse_rulebook(rulebook_path)
    confirm_llm = ScriptedLLM(
        [{"summary": ""}],
        keyed_responses={
            Level.PARAGRAPH: [
                {
                    "verdicts": [
                        {
                            "index": 0,
                            "violated": True,
                            "original_text": "간단한 목적 설명입니다.",
                            "description": "d",
                            "fix_direction": "f",
                            "excused": False,
                        }
                    ]
                }
            ],
            # _verify_one_false_positive isolates by the deduped issue's position (see
            # _verify_false_positives) even for a single finding — not a Level, since this is
            # the verify-stage branch, not the screen/confirm passes above.
            0: [{"actually_missing": False, "reason": "8장에 이미 있음"}],
        },
    )
    screen_llm = ScriptedLLM(
        keyed_responses={
            Level.PARAGRAPH: [
                {"candidates": [{"chunk_index": 0, "rule_id": "MI-01", "quoted_text": "간단한 목적 설명입니다.", "reason": "r"}]}
            ],
            Level.DOCUMENT: [_EMPTY_CANDIDATES],
        }
    )

    result = review_document("DOC-TEST", _DOC, rulebook, screen_llm, confirm_llm)

    assert result.issues == ()
    assert result.tier_errors == ()


def test_review_document_verifies_multiple_mi_findings_concurrently_preserving_order(rulebook_path):
    # Exercises _verify_false_positives' len(to_verify) > 1 branch (ThreadPoolExecutor +
    # isolate_client/merge_usage) — the single-finding case above only covers the sequential
    # fallback. Two MI candidates, verified with opposite verdicts, must come back with only
    # the kept one and in the original relative order — not reordered by whichever thread
    # happens to finish first.
    rulebook = parse_rulebook(rulebook_path)
    confirm_llm = ScriptedLLM(
        [{"summary": ""}],
        keyed_responses={
            Level.PARAGRAPH: [
                {
                    "verdicts": [
                        {
                            "index": 0,
                            "violated": True,
                            "original_text": "간단한 목적 설명입니다.",
                            "description": "d1",
                            "fix_direction": "f1",
                            "excused": False,
                        },
                        {
                            "index": 1,
                            "violated": True,
                            "original_text": "두번째 문단입니다.",
                            "description": "d2",
                            "fix_direction": "f2",
                            "excused": False,
                        },
                    ]
                }
            ],
            # keyed by the deduped issue's position (see _verify_false_positives'
            # isolate_client(llm, key=index)) — not a Level, since these two calls are the
            # verify-stage branches, not the screen/confirm passes above.
            0: [{"actually_missing": False, "reason": "8장에 이미 있음"}],
            1: [{"actually_missing": True, "reason": "정말 없음"}],
        },
    )
    screen_llm = ScriptedLLM(
        keyed_responses={
            Level.PARAGRAPH: [
                {
                    "candidates": [
                        {"chunk_index": 0, "rule_id": "MI-01", "quoted_text": "간단한 목적 설명입니다.", "reason": "r1"},
                        {"chunk_index": 1, "rule_id": "MI-01", "quoted_text": "두번째 문단입니다.", "reason": "r2"},
                    ]
                }
            ],
            Level.DOCUMENT: [_EMPTY_CANDIDATES],
        }
    )

    result = review_document("DOC-TEST", _DOC, rulebook, screen_llm, confirm_llm)

    [issue] = result.issues
    assert issue.original_text == "두번째 문단입니다."
    assert result.tier_errors == ()


def test_run_concurrently_caps_worker_count(monkeypatch):
    # A document with many MI/AE findings shouldn't fire one thread per finding — that's a
    # thundering-herd risk against the LLM backend, not real parallelism gain.
    recorded_max_workers: list[int] = []
    real_executor = bundled_screen_hybrid.ThreadPoolExecutor

    def spying_executor(*, max_workers):
        recorded_max_workers.append(max_workers)
        return real_executor(max_workers=max_workers)

    monkeypatch.setattr(bundled_screen_hybrid, "ThreadPoolExecutor", spying_executor)

    jobs = [(lambda i=i: i) for i in range(10)]
    results = _run_concurrently(jobs, max_workers=3)

    assert recorded_max_workers == [3]
    assert results == list(range(10))


def test_run_concurrently_runs_every_job_even_when_one_raises():
    # Each job (e.g. _verify_one_false_positive) isolates and merges its own LLM client
    # copy internally — that must happen for every job regardless of whether some other
    # job raises, not just for the ones whose .result() happens to get read before the
    # first exception surfaces.
    completed: list[int] = []

    def make_job(i: int):
        def job() -> int:
            if i == 1:
                raise RuntimeError("boom")
            completed.append(i)
            return i

        return job

    jobs = [make_job(i) for i in range(4)]

    with pytest.raises(RuntimeError):
        _run_concurrently(jobs, max_workers=4)

    assert sorted(completed) == [0, 2, 3]


def test_review_document_indexes_multiple_reference_documents_concurrently(rulebook_path):
    # Exercises the reference-document indexing loop's concurrent dispatch (was a purely
    # sequential loop — one confirm_llm round-trip per reference doc, all on the critical
    # path before the review even starts). Two reference docs, each keyed to its own
    # xdc_reference_index response, must both actually get indexed (not silently dropped or
    # mixed up by isolate_client(key=...) routing).
    rulebook = parse_rulebook(rulebook_path)
    xdc_rulebook = parse_rulebook(rulebook_path.parent / "xdc" / "xdc_rulebook_v1.0.md")

    confirm_llm = ScriptedLLM(
        [{"summary": ""}],
        keyed_responses={
            # keyed by the reference document's position in `reference_documents` (see
            # _index_one_reference_document) — not a Level, since these are the reference-
            # indexing branches, not the screen/confirm passes.
            0: [{"decision_records": []}],
            1: [{"decision_records": []}],
        },
    )
    screen_llm = ScriptedLLM(
        keyed_responses={
            Level.PARAGRAPH: [_EMPTY_CANDIDATES],
            Level.DOCUMENT: [_EMPTY_CANDIDATES],
        }
    )

    result = review_document(
        "DOC-TEST",
        _DOC,
        rulebook,
        screen_llm,
        confirm_llm,
        reference_documents=[
            ("REF-A", "# 참고문서 A\n\n## 정책\n\n내용입니다.\n"),
            ("REF-B", "# 참고문서 B\n\n## 정책\n\n내용입니다.\n"),
        ],
        xdc_rulebook=xdc_rulebook,
    )

    assert result.tier_errors == ()
    reference_index_calls = [event for event in result.call_events if event.stage == "xdc_reference_index"]
    assert len(reference_index_calls) == 2


def test_review_document_keeps_the_other_reference_index_when_one_fails(rulebook_path):
    # One reference document's indexing call blowing up (e.g. a malformed/empty response
    # queue) must not prevent the other reference document from being indexed — same
    # per-branch isolation _verify_false_positives relies on.
    rulebook = parse_rulebook(rulebook_path)
    xdc_rulebook = parse_rulebook(rulebook_path.parent / "xdc" / "xdc_rulebook_v1.0.md")

    confirm_llm = ScriptedLLM(
        [{"summary": ""}],
        keyed_responses={
            0: [{"decision_records": []}],
            # key 1 has no entry — ScriptedLLM.isolate() gives it an empty response queue,
            # so its complete_json() call raises when the queue is exhausted.
        },
    )
    screen_llm = ScriptedLLM(
        keyed_responses={
            Level.PARAGRAPH: [_EMPTY_CANDIDATES],
            Level.DOCUMENT: [_EMPTY_CANDIDATES],
        }
    )

    result = review_document(
        "DOC-TEST",
        _DOC,
        rulebook,
        screen_llm,
        confirm_llm,
        reference_documents=[
            ("REF-A", "# 참고문서 A\n\n## 정책\n\n내용입니다.\n"),
            ("REF-B", "# 참고문서 B\n\n## 정책\n\n내용입니다.\n"),
        ],
        xdc_rulebook=xdc_rulebook,
    )

    assert len(result.tier_errors) == 1
    assert "REF-B" in result.tier_errors[0]
    reference_index_calls = [event for event in result.call_events if event.stage == "xdc_reference_index"]
    assert len(reference_index_calls) == 1


def test_review_document_keeps_the_other_reference_index_when_one_fails_to_parse(rulebook_path, monkeypatch):
    # A reference doc that fails to even parse/chunk (not just fails its indexing LLM call)
    # must not sink the whole review either, and must not block the other reference doc from
    # being indexed — parse_document/chunks_for run outside _index_one_reference_document's
    # own try/except (they build the job's arguments before dispatch), so they need their own
    # guard.
    rulebook = parse_rulebook(rulebook_path)
    xdc_rulebook = parse_rulebook(rulebook_path.parent / "xdc" / "xdc_rulebook_v1.0.md")

    real_parse_document = bundled_screen_hybrid.parse_document

    def flaky_parse_document(doc_id: str, text: str):
        if doc_id == "REF-BAD":
            raise ValueError("malformed reference document")
        return real_parse_document(doc_id, text)

    monkeypatch.setattr(bundled_screen_hybrid, "parse_document", flaky_parse_document)

    confirm_llm = ScriptedLLM(
        [{"summary": ""}],
        keyed_responses={0: [{"decision_records": []}]},
    )
    screen_llm = ScriptedLLM(
        keyed_responses={
            Level.PARAGRAPH: [_EMPTY_CANDIDATES],
            Level.DOCUMENT: [_EMPTY_CANDIDATES],
        }
    )

    result = review_document(
        "DOC-TEST",
        _DOC,
        rulebook,
        screen_llm,
        confirm_llm,
        reference_documents=[
            ("REF-BAD", "# 참고문서 불량\n\n## 정책\n\n내용입니다.\n"),
            ("REF-A", "# 참고문서 A\n\n## 정책\n\n내용입니다.\n"),
        ],
        xdc_rulebook=xdc_rulebook,
    )

    assert len(result.tier_errors) == 1
    assert "REF-BAD" in result.tier_errors[0]
    reference_index_calls = [event for event in result.call_events if event.stage == "xdc_reference_index"]
    assert len(reference_index_calls) == 1


def test_confirm_xdc_system_prompt_requires_korean_output():
    # Regression: Gemini/Sonnet/o3-mini happened to answer in Korean just from the Korean
    # rule text in the prompt, with no explicit instruction — _SCREEN_HYBRID_BODY/
    # _CONFIRM_HYBRID_SYSTEM already got an explicit Korean-forcing line for this reason
    # (2026-08-30), but _CONFIRM_XDC_SYSTEM (added later, for the XDC track) never did.
    # Switching confirm_llm to gpt-4.1-mini broke that implicit assumption there — XDC
    # findings started coming back in English (found live, 2026-09-12).
    assert "Korean" in bundled_screen_hybrid._CONFIRM_XDC_SYSTEM
