from __future__ import annotations

from collections.abc import Callable
from types import SimpleNamespace
from typing import Any

import pytest
from google.genai import errors as genai_errors

from sunnic_backend.qa_engine.llm import gemini as gemini_module
from sunnic_backend.qa_engine.llm.base import parse_json_response
from sunnic_backend.qa_engine.llm.gemini import (
    _DEFAULT_RETRY_DELAY_SECONDS,
    GeminiClient,
    _retry_delay_seconds,
)


class _FakeModels:
    def __init__(self, side_effect: Callable[[], Any]) -> None:
        self._side_effect = side_effect

    async def generate_content(self, **_kwargs: Any) -> Any:
        result = self._side_effect()
        if isinstance(result, Exception):
            raise result
        return SimpleNamespace(text=result)


class _FakeClient:
    def __init__(self, side_effect: Callable[[], Any]) -> None:
        self.aio = SimpleNamespace(models=_FakeModels(side_effect))


def _client_factory(side_effects_by_key: dict[str, Callable[[], Any]]) -> Callable[..., _FakeClient]:
    def factory(api_key: str) -> _FakeClient:
        return _FakeClient(side_effects_by_key[api_key])

    return factory


def _rate_limit_error() -> genai_errors.ClientError:
    return genai_errors.ClientError(code=429, response_json={})


def test_requires_at_least_one_api_key() -> None:
    with pytest.raises(RuntimeError):
        GeminiClient(api_keys=[])


async def test_complete_json_returns_parsed_response(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(gemini_module.genai, "Client", _client_factory({"k1": lambda: '{"flagged": true}'}))

    client = GeminiClient(api_keys=["k1"])
    result = await client.complete_json(system="sys", prompt="p")

    assert result == {"flagged": True}


async def test_rotates_to_next_key_on_429(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        gemini_module.genai,
        "Client",
        _client_factory({"k1": _rate_limit_error, "k2": lambda: '{"flagged": false}'}),
    )

    client = GeminiClient(api_keys=["k1", "k2"])
    result = await client.complete_json(system="sys", prompt="p")

    assert result == {"flagged": False}
    assert client._current == 1


async def test_raises_after_exhausting_all_keys_every_cycle(monkeypatch: pytest.MonkeyPatch) -> None:
    sleep_calls = []

    async def fake_sleep(seconds: float) -> None:
        sleep_calls.append(seconds)

    monkeypatch.setattr(gemini_module.asyncio, "sleep", fake_sleep)
    monkeypatch.setattr(
        gemini_module.genai,
        "Client",
        _client_factory({"k1": _rate_limit_error, "k2": _rate_limit_error}),
    )

    client = GeminiClient(api_keys=["k1", "k2"])
    with pytest.raises(genai_errors.ClientError):
        await client.complete_json(system="sys", prompt="p")

    assert len(sleep_calls) == 3  # _MAX_CYCLES


async def test_non_429_error_propagates_immediately(monkeypatch: pytest.MonkeyPatch) -> None:
    def server_error() -> genai_errors.ClientError:
        return genai_errors.ClientError(code=500, response_json={})

    monkeypatch.setattr(
        gemini_module.genai,
        "Client",
        _client_factory({"k1": server_error, "k2": lambda: '{"flagged": true}'}),
    )

    client = GeminiClient(api_keys=["k1", "k2"])
    with pytest.raises(genai_errors.ClientError):
        await client.complete_json(system="sys", prompt="p")

    assert client._current == 0  # never rotated — non-429 errors don't trigger rotation


def test_retry_delay_seconds_reads_retry_info_from_error_details() -> None:
    error = genai_errors.ClientError(
        code=429,
        response_json={"error": {"details": [{"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": "13s"}]}},
    )

    assert _retry_delay_seconds(error) == 13.0


def test_retry_delay_seconds_falls_back_to_default_without_retry_info() -> None:
    error = genai_errors.ClientError(code=429, response_json={})

    assert _retry_delay_seconds(error) == _DEFAULT_RETRY_DELAY_SECONDS


def test_parse_json_response_strips_markdown_fence() -> None:
    assert parse_json_response('```json\n{"a": 1}\n```') == {"a": 1}


def test_parse_json_response_handles_plain_json() -> None:
    assert parse_json_response('{"a": 1}') == {"a": 1}
