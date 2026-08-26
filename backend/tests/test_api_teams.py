import re

from httpx import ASGITransport, AsyncClient

from sunnic_backend.main import app
from sunnic_backend.models.team import Team
from sunnic_backend.storage.store import store

_DEFAULT_EXAMPLES = {"error1": {"error": "", "correction": ""}, "error2": {"error": "", "correction": ""}, "exception": ""}


async def _create_team(client: AsyncClient, team_name: str = "서비스기획 2팀", description: str = "설명") -> dict:
    response = await client.post("/teams", json={"team_name": team_name, "description": description})
    assert response.status_code == 200
    return response.json()


async def test_save_team_if_new_rejects_a_taken_code() -> None:
    # The TOCTOU race this exists to close: a separate get_team() check + save_team() call
    # leaves a window where two concurrent creates can both pass the check for the same
    # generated code before either saves — folding check-and-reserve into one lock
    # acquisition means the second caller for the same code always loses deterministically.
    code = "RACE01"
    first = Team(team_code=code, team_name="먼저 생성", description="")
    second = Team(team_code=code, team_name="나중에 생성", description="")

    assert await store.save_team_if_new(first) is True
    assert await store.save_team_if_new(second) is False
    assert (await store.get_team(code)).team_name == "먼저 생성"


async def test_create_team_returns_generated_code() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        body = await _create_team(client)

    assert re.fullmatch(r"[A-Z0-9]{6}", body["team_code"])
    assert body["team_name"] == "서비스기획 2팀"
    assert body["description"] == "설명"


async def test_get_team_404_for_unknown_code() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/teams/NOPE00")

    assert response.status_code == 404


async def test_get_team_returns_created_team() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        created = await _create_team(client)
        response = await client.get(f"/teams/{created['team_code']}")

    assert response.status_code == 200
    assert response.json() == created


async def test_create_team_rule_404_for_unknown_team() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post("/teams/NOPE00/rules", json={"rule_name": "규칙", "description": "설명"})

    assert response.status_code == 404


async def test_create_team_rule_defaults_optional_fields() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        team = await _create_team(client)
        response = await client.post(
            f"/teams/{team['team_code']}/rules", json={"rule_name": "정책 정합성", "description": "정책 정합성 검토"}
        )

    assert response.status_code == 200
    body = response.json()
    assert "id" in body
    assert body["rule_name"] == "정책 정합성"
    assert body["description"] == "정책 정합성 검토"
    assert body["exception_text"] is None
    assert body["examples"] == _DEFAULT_EXAMPLES
    assert body["enabled"] is True


async def test_create_team_rule_accepts_examples_and_disabled_state() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        team = await _create_team(client)
        response = await client.post(
            f"/teams/{team['team_code']}/rules",
            json={
                "rule_name": "표준 용어 일치",
                "description": "설명",
                "exception_text": "예외 조건",
                "examples": {
                    "error1": {"error": "무료 이용자는 월 3회까지 사용할 수 있다.", "correction": "무료 이용자는 월 5회까지 사용할 수 있다."},
                    "error2": {"error": "", "correction": ""},
                    "exception": "정책 변경이 확정되었으나 문서가 업데이트되지 않은 경우",
                },
                "enabled": False,
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["examples"]["error1"]["error"] == "무료 이용자는 월 3회까지 사용할 수 있다."
    assert body["examples"]["exception"] == "정책 변경이 확정되었으나 문서가 업데이트되지 않은 경우"
    assert body["enabled"] is False


async def test_list_team_rules_reflects_created_rules() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        team = await _create_team(client)
        await client.post(f"/teams/{team['team_code']}/rules", json={"rule_name": "규칙1", "description": "규칙 1"})
        await client.post(f"/teams/{team['team_code']}/rules", json={"rule_name": "규칙2", "description": "규칙 2"})
        response = await client.get(f"/teams/{team['team_code']}/rules")

    assert response.status_code == 200
    descriptions = {rule["description"] for rule in response.json()}
    assert descriptions == {"규칙 1", "규칙 2"}


async def test_update_team_rule_updates_fields() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        team = await _create_team(client)
        created = (
            await client.post(f"/teams/{team['team_code']}/rules", json={"rule_name": "원본 이름", "description": "원본"})
        ).json()

        response = await client.patch(
            f"/teams/{team['team_code']}/rules/{created['id']}",
            json={
                "rule_name": "수정된 이름",
                "description": "수정됨",
                "exception_text": "정책 변경이 확정되었으나 문서에 반영되지 않은 경우",
                "examples": {
                    "error1": {"error": "월 3회", "correction": "월 5회"},
                    "error2": {"error": "", "correction": ""},
                    "exception": "",
                },
                "enabled": False,
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["rule_name"] == "수정된 이름"
    assert body["description"] == "수정됨"
    assert body["exception_text"] == "정책 변경이 확정되었으나 문서에 반영되지 않은 경우"
    assert body["examples"]["error1"] == {"error": "월 3회", "correction": "월 5회"}
    assert body["enabled"] is False


async def test_update_team_rule_404_for_wrong_team() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        team_a = await _create_team(client, team_name="팀A")
        team_b = await _create_team(client, team_name="팀B")
        created = (
            await client.post(f"/teams/{team_a['team_code']}/rules", json={"rule_name": "이름", "description": "원본"})
        ).json()

        response = await client.patch(
            f"/teams/{team_b['team_code']}/rules/{created['id']}",
            json={"rule_name": "이름", "description": "탈취 시도"},
        )

    assert response.status_code == 404


async def test_delete_team_rule_removes_it() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        team = await _create_team(client)
        created = (
            await client.post(f"/teams/{team['team_code']}/rules", json={"rule_name": "이름", "description": "삭제 대상"})
        ).json()

        delete_response = await client.delete(f"/teams/{team['team_code']}/rules/{created['id']}")
        list_response = await client.get(f"/teams/{team['team_code']}/rules")
        second_delete_response = await client.delete(f"/teams/{team['team_code']}/rules/{created['id']}")

    assert delete_response.status_code == 200
    assert delete_response.json() == {"id": created["id"]}
    assert list_response.json() == []
    assert second_delete_response.status_code == 404


async def test_set_team_rule_enabled_toggles_without_touching_other_fields() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        team = await _create_team(client)
        created = (
            await client.post(
                f"/teams/{team['team_code']}/rules", json={"rule_name": "이름", "description": "설명", "enabled": True}
            )
        ).json()

        response = await client.patch(f"/teams/{team['team_code']}/rules/{created['id']}/enabled", json={"enabled": False})

    assert response.status_code == 200
    body = response.json()
    assert body["enabled"] is False
    assert body["rule_name"] == "이름"
    assert body["description"] == "설명"


async def test_set_team_rule_enabled_does_not_revert_a_concurrent_edit() -> None:
    # The bug this endpoint exists to avoid: update_team_rule (full-replace) requires resending
    # every field, so a toggle built on a stale client-side copy of the rule would silently
    # revert whatever another editor just saved via a full PATCH in between.
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        team = await _create_team(client)
        created = (
            await client.post(f"/teams/{team['team_code']}/rules", json={"rule_name": "이름", "description": "원본"})
        ).json()

        await client.patch(
            f"/teams/{team['team_code']}/rules/{created['id']}",
            json={"rule_name": "이름", "description": "다른 편집자가 저장한 설명"},
        )
        response = await client.patch(f"/teams/{team['team_code']}/rules/{created['id']}/enabled", json={"enabled": False})

    assert response.status_code == 200
    assert response.json()["description"] == "다른 편집자가 저장한 설명"


async def test_set_team_rule_enabled_404_for_wrong_team() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        team_a = await _create_team(client, team_name="팀A")
        team_b = await _create_team(client, team_name="팀B")
        created = (
            await client.post(f"/teams/{team_a['team_code']}/rules", json={"rule_name": "이름", "description": "원본"})
        ).json()

        response = await client.patch(f"/teams/{team_b['team_code']}/rules/{created['id']}/enabled", json={"enabled": False})

    assert response.status_code == 404
