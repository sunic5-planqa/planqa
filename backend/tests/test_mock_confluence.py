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


async def test_content_endpoint_returns_parent_ancestor() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/wiki/rest/api/content/482910?expand=ancestors")

    assert response.status_code == 200
    assert response.json()["ancestors"] == [{"id": "482900", "title": "결제 시스템 개선"}]


async def test_child_pages_endpoint_lists_siblings_including_self() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/wiki/rest/api/content/482900/child/page")

    assert response.status_code == 200
    results = response.json()["results"]
    assert {"id": "482910", "title": "결제 시스템 개선 기획서 (PRD)"} in results
    assert {"id": "482911", "title": "결제 요구사항 정의서"} in results
    assert len(results) == 5


async def test_child_pages_endpoint_returns_empty_for_unknown_parent() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/wiki/rest/api/content/999/child/page")

    assert response.status_code == 200
    assert response.json()["results"] == []


async def test_content_endpoint_returns_sibling_body() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/wiki/rest/api/content/482911?expand=body.storage")

    assert response.status_code == 200
    body = response.json()
    assert body["title"] == "결제 요구사항 정의서"
    assert "카카오페이" in body["body"]["storage"]["value"]


async def test_content_endpoint_includes_version_when_requested() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/wiki/rest/api/content/482913?expand=body.storage,version")

    assert response.status_code == 200
    assert response.json()["version"] == {"number": 1}


async def test_put_updates_page_body_and_bumps_version() -> None:
    # 482913(결제 API 명세서)만 건드려서 다른 테스트의 title/본문 assertion과 겹치지 않게 한다.
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        put_response = await client.put(
            "/wiki/rest/api/content/482913",
            json={
                "version": {"number": 2},
                "title": "결제 API 명세서",
                "type": "page",
                "body": {"storage": {"value": "<p>테스트 수정 확인용 새 본문</p>", "representation": "storage"}},
            },
        )
        assert put_response.status_code == 200
        assert put_response.json()["version"] == {"number": 2}

        get_response = await client.get("/wiki/rest/api/content/482913?expand=body.storage")
        assert "테스트 수정 확인용 새 본문" in get_response.json()["body"]["storage"]["value"]


async def test_put_rejects_stale_version_with_409() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.put(
            "/wiki/rest/api/content/482914",
            json={
                "version": {"number": 99},
                "title": "용어집",
                "type": "page",
                "body": {"storage": {"value": "<p>충돌 테스트</p>", "representation": "storage"}},
            },
        )

    assert response.status_code == 409


async def test_put_returns_404_for_unknown_page() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.put(
            "/wiki/rest/api/content/999999",
            json={
                "version": {"number": 2},
                "title": "없는 문서",
                "type": "page",
                "body": {"storage": {"value": "<p>x</p>", "representation": "storage"}},
            },
        )

    assert response.status_code == 404


async def test_content_endpoint_includes_space_when_requested() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/wiki/rest/api/content/482910?expand=space")

    assert response.status_code == 200
    assert response.json()["space"] == {"key": "MFS"}


async def test_post_creates_a_new_page_that_is_then_readable_and_writable() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        create_response = await client.post(
            "/wiki/rest/api/content",
            json={
                "type": "page",
                "title": "결제 시스템 개선 기획서 (PRD) (QA 검토 수정본)",
                "space": {"key": "MFS"},
                "ancestors": [{"id": "482910"}],
                "body": {"storage": {"value": "<p>복제된 원문</p>", "representation": "storage"}},
            },
        )

        assert create_response.status_code == 200
        created = create_response.json()
        assert created["version"] == {"number": 1}
        new_id = created["id"]
        assert new_id != "482910"

        get_response = await client.get(f"/wiki/rest/api/content/{new_id}?expand=body.storage")
        assert "복제된 원문" in get_response.json()["body"]["storage"]["value"]

        page_response = await client.get(f"/mock-confluence/pages/{new_id}")
        assert "복제된 원문" in page_response.text

        # 복제본 자체도 PUT으로 계속 갱신 가능해야 함(2번째 이후 수정 반영 경로).
        put_response = await client.put(
            f"/wiki/rest/api/content/{new_id}",
            json={
                "version": {"number": 2},
                "title": created["title"],
                "type": "page",
                "body": {"storage": {"value": "<p>복제본에 추가로 수정된 내용</p>", "representation": "storage"}},
            },
        )
        assert put_response.status_code == 200


async def test_post_creates_pages_with_unique_ids() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        payload = {
            "type": "page",
            "title": "중복 확인용",
            "space": {"key": "MFS"},
            "body": {"storage": {"value": "<p>x</p>", "representation": "storage"}},
        }
        first = await client.post("/wiki/rest/api/content", json=payload)
        second = await client.post("/wiki/rest/api/content", json=payload)

    assert first.json()["id"] != second.json()["id"]
