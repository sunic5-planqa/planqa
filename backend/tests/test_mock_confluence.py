from httpx import ASGITransport, AsyncClient

from sunnic_backend.main import app


async def test_mock_page_renders_prd_content() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/mock-confluence/pages/482910")

    assert response.status_code == 200
    assert "결제 시스템 개선 기획서" in response.text
    assert "간편결제(카카오페이, 네이버페이, 토스) 3사만 지원, 페이코 미지원" in response.text


async def test_content_endpoint_returns_storage_body_by_default() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/wiki/rest/api/content/482910?expand=body.storage")

    assert response.status_code == 200
    body = response.json()
    assert body["title"] == "결제 시스템 개선 기획서 (PRD)"
    assert "페이코, 삼성페이 추가 연동" in body["body"]["storage"]["value"]


async def test_content_endpoint_returns_empty_ancestors() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/wiki/rest/api/content/482910?expand=ancestors")

    assert response.status_code == 200
    assert response.json()["ancestors"] == []


async def test_child_pages_endpoint_returns_empty_results() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/wiki/rest/api/content/1/child/page")

    assert response.status_code == 200
    assert response.json()["results"] == []
