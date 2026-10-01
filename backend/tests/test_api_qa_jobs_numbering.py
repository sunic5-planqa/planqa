import uuid
from datetime import UTC, datetime

from httpx import ASGITransport, AsyncClient

from sunnic_backend.main import app
from sunnic_backend.models.qa_job import QAJob, QAJobStatus
from sunnic_backend.storage.store import store

_DOCUMENT_TEXT = "# 기획서\n## 1. 개요\n## 2. 문제 정의\n## 4. 해결 방안\n## 5. 기대 효과"


async def _create_document_and_job(client: AsyncClient) -> str:
    response = await client.post("/documents", json={"raw_text": _DOCUMENT_TEXT})
    document_id = response.json()["document_id"]
    job = QAJob(
        id=str(uuid.uuid4()),
        document_id=document_id,
        status=QAJobStatus.DONE,
        progress=100,
        current_category=None,
        started_at=datetime.now(UTC),
    )
    await store.save_qa_job(job)
    return job.id


async def test_numbering_issues_404_for_unknown_job() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/qa-jobs/does-not-exist/numbering-issues", json={"raw_text": _DOCUMENT_TEXT}
        )
    assert response.status_code == 404


async def test_numbering_issues_404_when_document_missing() -> None:
    job = QAJob(
        id=str(uuid.uuid4()),
        document_id="missing-document",
        status=QAJobStatus.DONE,
        progress=100,
        current_category=None,
        started_at=datetime.now(UTC),
    )
    await store.save_qa_job(job)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(f"/qa-jobs/{job.id}/numbering-issues", json={"raw_text": _DOCUMENT_TEXT})
    assert response.status_code == 404


async def test_numbering_issues_returns_detected_errors() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        job_id = await _create_document_and_job(client)
        response = await client.post(f"/qa-jobs/{job_id}/numbering-issues", json={"raw_text": _DOCUMENT_TEXT})

    assert response.status_code == 200
    body = response.json()
    assert {issue["before_text"] for issue in body} == {"4. 해결 방안", "5. 기대 효과"}


async def test_numbering_issues_uses_fresh_text_not_stale_document_text() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        clean_text = "# 기획서\n## 1. 개요\n## 2. 문제 정의"
        response = await client.post("/documents", json={"raw_text": clean_text})
        document_id = response.json()["document_id"]
        job = QAJob(
            id=str(uuid.uuid4()),
            document_id=document_id,
            status=QAJobStatus.DONE,
            progress=100,
            current_category=None,
            started_at=datetime.now(UTC),
        )
        await store.save_qa_job(job)

        # 리뷰 중 실제 페이지가 이렇게 바뀌었다고 가정(never synced back, since PATCH /issues 미구현)
        fresh_text = "# 기획서\n## 1. 개요\n## 3. 문제 정의"

        result = await client.post(f"/qa-jobs/{job.id}/numbering-issues", json={"raw_text": fresh_text})
        assert result.status_code == 200
        assert {issue["before_text"] for issue in result.json()} == {"3. 문제 정의"}

        stored = await store.get_document(document_id)
        assert stored is not None
        assert stored.raw_text == fresh_text
