from httpx import ASGITransport, AsyncClient

from sunnic_backend.main import app


async def test_list_rulebook_categories_returns_eight_categories() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/rulebook/categories")

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 8


async def test_list_rulebook_categories_labels_are_korean_only() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/rulebook/categories")

    labels = {item["label"] for item in response.json()}
    assert "논리비약" in labels
    assert not any(" " in label and any(c.isascii() and c.isalpha() for c in label) for label in labels)
