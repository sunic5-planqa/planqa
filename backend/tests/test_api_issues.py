from typing import Any

from httpx import ASGITransport, AsyncClient

from sunnic_backend.api import issues
from sunnic_backend.main import app

_REQUEST_BODY = {
    "original_text": "간편결제(카카오페이, 네이버페이, 토스) 3사만 지원, 페이코 미지원 안내.",
    "criteria": "용어 및 단어의 일관성",
    "reason": "앞서 4장에서는 페이코를 포함한 4사 지원이라고 했는데 여기선 3사라고 함",
    "suggestion": "구체적인 지원사 목록을 4장과 일치시켜 다시 작성해보세요.",
    "edited_text": "간편결제(카카오페이, 네이버페이, 토스, 페이코) 4사 지원.",
}


class _StubClient:
    def __init__(self, response: Any | None) -> None:
        self._response = response

    def __call__(self, model: str | None = None, api_key: str | None = None) -> "_StubClient":
        return self

    def complete_json(self, *, system: str, prompt: str, cache_prefix: str | None = None) -> Any:
        if self._response is None:
            raise RuntimeError("boom")
        return self._response


async def test_similarity_check_passes_when_llm_confirms_edit_addresses_the_issue(monkeypatch) -> None:
    monkeypatch.setattr(issues, "AnthropicClient", _StubClient({"addresses_issue": True, "reason": "일치시킴"}))

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post("/issues/similarity-check", json=_REQUEST_BODY)

    assert response.status_code == 200
    body = response.json()
    assert body["addresses_issue"] is True
    assert body["reason"] == "일치시킴"


async def test_similarity_check_flags_edit_that_does_not_address_the_issue(monkeypatch) -> None:
    monkeypatch.setattr(
        issues, "AnthropicClient", _StubClient({"addresses_issue": False, "reason": "여전히 3사로만 되어 있음"})
    )

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post("/issues/similarity-check", json=_REQUEST_BODY)

    body = response.json()
    assert body["addresses_issue"] is False
    assert body["reason"] == "여전히 3사로만 되어 있음"


# 지시형 제안("~할 것을 고려해보세요")과 실제 사용자 수정본은 글자 유사도가 낮아도 검증기준을
# 실질적으로 만족시킬 수 있다 — 프롬프트가 이걸 명시적으로 요구하므로, LLM에 전달되는 프롬프트에
# 실제로 그 취지가 담겨 전달되는지(검증기준/검증이유까지 같이 보내는지) 확인한다.
async def test_similarity_check_sends_criteria_and_reason_to_the_llm(monkeypatch) -> None:
    captured: dict[str, str] = {}

    class _CapturingClient(_StubClient):
        def complete_json(self, *, system: str, prompt: str, cache_prefix: str | None = None) -> Any:
            captured["prompt"] = prompt
            return {"addresses_issue": True, "reason": "ok"}

    monkeypatch.setattr(issues, "AnthropicClient", _CapturingClient({"addresses_issue": True, "reason": "ok"}))

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        await client.post("/issues/similarity-check", json=_REQUEST_BODY)

    assert _REQUEST_BODY["criteria"] in captured["prompt"]
    assert _REQUEST_BODY["reason"] in captured["prompt"]
    assert _REQUEST_BODY["suggestion"] in captured["prompt"]
    assert _REQUEST_BODY["edited_text"] in captured["prompt"]


async def test_similarity_check_fails_open_by_allowing_the_save_on_llm_error(monkeypatch) -> None:
    monkeypatch.setattr(issues, "AnthropicClient", _StubClient(None))

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post("/issues/similarity-check", json=_REQUEST_BODY)

    assert response.status_code == 200
    assert response.json()["addresses_issue"] is True


async def test_similarity_check_fails_open_on_malformed_response(monkeypatch) -> None:
    monkeypatch.setattr(issues, "AnthropicClient", _StubClient("not a dict"))

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post("/issues/similarity-check", json=_REQUEST_BODY)

    assert response.status_code == 200
    assert response.json()["addresses_issue"] is True
