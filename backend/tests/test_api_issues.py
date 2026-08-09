from httpx import ASGITransport, AsyncClient

from sunnic_backend.main import app


async def test_similarity_check_returns_high_score_for_identical_text() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/issues/similarity-check",
            json={"suggestion": "4사만 지원, 페이코 미지원", "edited_text": "4사만 지원, 페이코 미지원"},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["similarity"] == 1.0
    assert body["matches_closely"] is True


async def test_similarity_check_flags_unrelated_text() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/issues/similarity-check",
            json={"suggestion": "간편결제 4사만 지원, 페이코 미지원", "edited_text": "오늘 점심 메뉴는 김치찌개다"},
        )

    body = response.json()
    assert body["similarity"] < 0.3
    assert body["matches_closely"] is False


async def test_similarity_check_matches_closely_for_minor_edits() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/issues/similarity-check",
            json={
                "suggestion": "간편결제(카카오페이, 네이버페이, 토스, 삼성페이) 4사만 지원, 페이코 미지원",
                "edited_text": "간편결제(카카오페이, 네이버페이, 토스, 삼성페이) 4사 지원, 페이코는 미지원",
            },
        )

    assert response.json()["matches_closely"] is True
