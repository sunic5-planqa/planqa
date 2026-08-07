from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from sunnic_backend.qa_engine.review_agent.llm.base import CallStats, LLMClient

DATA_DIR = Path(__file__).resolve().parents[3] / "src" / "sunnic_backend" / "qa_engine" / "review_agent" / "data"


@pytest.fixture
def rulebook_path() -> Path:
    return DATA_DIR / "rulebook_v1.0.md"


@pytest.fixture
def source_dir() -> Path:
    # Only DOC-001 is vendored here (regression fixture for document.py) — the full 40-doc
    # benchmark set lives in the review-agent repo (sunic5-planqa/planqa-agent), not here.
    return Path(__file__).resolve().parent / "fixtures"


class ScriptedLLM(LLMClient):
    """Returns whatever `responses` yields next, in call order — lets tests script exact
    LLM replies without any network access."""

    def __init__(self, responses: list[Any]) -> None:
        self.model = "fake"
        self._responses = iter(responses)
        self.calls: list[dict[str, str]] = []
        self.usage: list[CallStats] = []

    def complete_json(self, *, system: str, prompt: str) -> Any:
        self.calls.append({"system": system, "prompt": prompt})
        self.usage.append(CallStats(elapsed_seconds=0.0, prompt_tokens=None, completion_tokens=None, total_tokens=None))
        return next(self._responses)
