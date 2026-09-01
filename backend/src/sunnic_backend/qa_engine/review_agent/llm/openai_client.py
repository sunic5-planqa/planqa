from __future__ import annotations

import os
import time
from typing import Any

import openai

from sunnic_backend.qa_engine.review_agent.llm.base import (
    CallStats,
    LLMClient,
    parse_json_response,
)

DEFAULT_MODEL = "gpt-5-mini"

_MAX_ATTEMPTS = 4
_RETRY_DELAY_SECONDS = 5.0
# Reasoning models can genuinely take a while on a large rule+chunk prompt (unlike the
# simple confirm calls anthropic.py sizes for) — generous enough to not cut off a real
# in-progress response, but still bounded so a stalled connection fails into the retry
# loop above instead of hanging the whole QA job indefinitely.
_REQUEST_TIMEOUT_SECONDS = 120.0

# Reasoning-family models (gpt-5*, o1*, o3*, o4*) reject an explicit `temperature` — mirrors
# anthropic.py's _NO_TEMPERATURE_MODELS guard for the same class of restriction.
_NO_TEMPERATURE_PREFIXES = ("gpt-5", "o1", "o3", "o4")


def _load_api_key(explicit: str | None) -> str:
    key = explicit or os.environ.get("OPENAI_API_KEY")
    if not key:
        raise RuntimeError("No OpenAI API key found — set OPENAI_API_KEY in .env")
    return key


class OpenAIClient(LLMClient):
    # TEMP (2026-08-29): stands in for both screen_llm and confirm_llm while the Gemini key
    # situation gets sorted — see qa_jobs.py's _run_review_sync for the wiring and why.

    def __init__(
        self,
        model: str = DEFAULT_MODEL,
        api_key: str | None = None,
        temperature: float = 0.0,
        client: openai.OpenAI | None = None,
    ) -> None:
        self.model = model
        self._temperature = temperature
        self.usage: list[CallStats] = []
        self._client = client or openai.OpenAI(api_key=_load_api_key(api_key), timeout=_REQUEST_TIMEOUT_SECONDS)

    def complete_json(self, *, system: str, prompt: str, cache_prefix: str | None = None) -> Any:
        full_prompt = f"{cache_prefix}\n\n{prompt}" if cache_prefix else prompt
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": full_prompt},
        ]
        start = time.perf_counter()
        last_error: openai.OpenAIError | ValueError | None = None
        for attempt in range(_MAX_ATTEMPTS):
            kwargs: dict[str, Any] = dict(
                model=self.model,
                messages=messages,
                response_format={"type": "json_object"},
            )
            if not self.model.startswith(_NO_TEMPERATURE_PREFIXES):
                kwargs["temperature"] = self._temperature
            try:
                response = self._client.chat.completions.create(**kwargs)
            except (openai.RateLimitError, openai.InternalServerError, openai.APIConnectionError) as error:
                # RateLimitError (429), InternalServerError (5xx), and connection-level
                # failures/timeouts are all transient — worth retrying the same request.
                last_error = error
                if attempt < _MAX_ATTEMPTS - 1:
                    time.sleep(_RETRY_DELAY_SECONDS)
                continue
            usage = response.usage
            self.usage.append(
                CallStats(
                    elapsed_seconds=time.perf_counter() - start,
                    prompt_tokens=usage.prompt_tokens if usage else None,
                    completion_tokens=usage.completion_tokens if usage else None,
                    total_tokens=usage.total_tokens if usage else None,
                )
            )
            content = response.choices[0].message.content
            try:
                if not content:
                    raise ValueError("empty content in OpenAI response")
                return parse_json_response(content)
            except ValueError as error:
                last_error = error
                if attempt < _MAX_ATTEMPTS - 1:
                    time.sleep(_RETRY_DELAY_SECONDS)
                continue
        raise last_error
