from __future__ import annotations

from typing import Any

from sunnic_backend.qa_engine.team_rule_classifier import classify_scope


class _ScriptedLLM:
    def __init__(self, response: Any) -> None:
        self._response = response
        self.calls: list[tuple[str, str]] = []

    def complete_json(self, *, system: str, prompt: str, cache_prefix: str | None = None) -> Any:
        self.calls.append((system, prompt))
        if isinstance(self._response, Exception):
            raise self._response
        return self._response


def test_classify_scope_returns_the_models_scope() -> None:
    llm = _ScriptedLLM({"scope": "relational"})
    assert classify_scope("이름", "설명", None, llm) == "relational"


def test_classify_scope_falls_back_to_paragraph_for_an_invalid_value() -> None:
    llm = _ScriptedLLM({"scope": "something_else"})
    assert classify_scope("이름", "설명", None, llm) == "paragraph"


def test_classify_scope_falls_back_to_paragraph_when_the_response_is_not_a_dict() -> None:
    llm = _ScriptedLLM(["not", "a", "dict"])
    assert classify_scope("이름", "설명", None, llm) == "paragraph"


def test_classify_scope_falls_back_to_paragraph_on_llm_error() -> None:
    llm = _ScriptedLLM(RuntimeError("network error"))
    assert classify_scope("이름", "설명", None, llm) == "paragraph"


def test_classify_scope_includes_the_exception_text_in_the_prompt() -> None:
    llm = _ScriptedLLM({"scope": "paragraph"})
    classify_scope("이름", "설명", "특정 예외 조건", llm)
    assert "특정 예외 조건" in llm.calls[0][1]
