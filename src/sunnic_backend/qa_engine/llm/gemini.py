from __future__ import annotations

import asyncio
from typing import Any

from google import genai
from google.genai import errors as genai_errors
from google.genai import types

from sunnic_backend.qa_engine.llm.base import LLMClient, parse_json_response

DEFAULT_MODEL = "gemini-3.5-flash-lite"
_MAX_CYCLES = 3
_DEFAULT_RETRY_DELAY_SECONDS = 20.0


def _retry_delay_seconds(error: genai_errors.ClientError) -> float:
    details = error.details if isinstance(error.details, dict) else {}
    for detail in details.get("error", {}).get("details", []):
        if detail.get("@type", "").endswith("RetryInfo"):
            raw = detail.get("retryDelay", "")
            if raw.endswith("s"):
                try:
                    return float(raw[:-1])
                except ValueError:
                    pass
    return _DEFAULT_RETRY_DELAY_SECONDS


class GeminiClient(LLMClient):
    """1단계 스크리닝 클라이언트. 429에서 api_keys를 라운드로빈 —
    무료 티어는 키당 분당 5회/일 20회 수준으로 캡이 낮음."""

    def __init__(self, api_keys: list[str], model: str = DEFAULT_MODEL) -> None:
        if not api_keys:
            raise RuntimeError(
                "No Gemini API key configured — set GEMINI_API_KEYS in .env "
                "(see sunnic_backend.config.Settings.gemini_api_keys)"
            )
        self.model = model
        self._clients = [genai.Client(api_key=key) for key in api_keys]
        self._current = 0
        self._lock = asyncio.Lock()

    async def complete_json(self, *, system: str, prompt: str) -> Any:
        last_error: genai_errors.ClientError | None = None
        for _cycle in range(_MAX_CYCLES):
            for _ in range(len(self._clients)):
                async with self._lock:
                    client = self._clients[self._current]
                try:
                    response = await client.aio.models.generate_content(
                        model=self.model,
                        contents=prompt,
                        config=types.GenerateContentConfig(
                            system_instruction=system,
                            response_mime_type="application/json",
                        ),
                    )
                    return parse_json_response(response.text)
                except genai_errors.ClientError as error:
                    if error.code != 429:
                        raise
                    last_error = error
                    async with self._lock:
                        self._current = (self._current + 1) % len(self._clients)
            await asyncio.sleep(_retry_delay_seconds(last_error))
        raise last_error
