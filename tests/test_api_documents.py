from httpx import ASGITransport, AsyncClient

from sunnic_backend.main import app


async def test_create_document_returns_parsed_structure() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/documents",
            json={"raw_text": "# 제목\n\n## 배경\n\n배경 설명입니다."},
        )

    assert response.status_code == 200
    body = response.json()
    assert "document_id" in body
    assert body["parsed_structure"]["title"] == "제목"
    assert body["parsed_structure"]["chapters"][0]["title"] == "배경"


async def test_healthz() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/healthz")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_export_stub_returns_501_for_existing_document() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        create_response = await client.post("/documents", json={"raw_text": "내용"})
        document_id = create_response.json()["document_id"]

        response = await client.get(f"/documents/{document_id}/export")

    assert response.status_code == 501


async def test_export_returns_404_for_unknown_document() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/documents/does-not-exist/export")

    assert response.status_code == 404
