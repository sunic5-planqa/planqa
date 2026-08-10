from __future__ import annotations

import re
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient

from sunnic_backend.api import qa_jobs
from sunnic_backend.main import app
from sunnic_backend.qa_engine.review_agent.llm.base import CallStats

_TEST_DOCUMENT = (
    "# 결제 시스템 개선 기획서\n\n"
    "## 1. 배경 및 문제 정의\n\n"
    "간편결제(카카오페이, 네이버페이, 토스) 3사만 지원, 페이코 미지원.\n\n"
    "## 2. 주요 요구사항\n\n"
    "페이코, 삼성페이 추가 연동을 목표로 한다.\n"
)

# category_screen's screen prompt only lists "{2-letter category}: {label}" lines (no rule
# text/id — that's confirm's job), while its confirm prompt indents each candidate rule as
# "    {rule_id}: {text} (exception: ...)" — hence the two different regexes below.
_CATEGORY_RE = re.compile(r"^([A-Z]{2}):", re.MULTILINE)
_RULE_ID_RE = re.compile(r"^\s*([A-Z]{2}-\d{2}):", re.MULTILINE)
_CHUNK_ZERO_RE = re.compile(r"\[0\] \([^)]*\)\n(.+?)(?:\n\n|\Z)", re.DOTALL)


# qa_jobs._review_cache는 프로세스 전역이라, 한 테스트가 채워놓은 캐시를 다른 테스트가(특히 같은
# _TEST_DOCUMENT를 쓰는 테스트들이) 모르는 새 재사용하면서 실행 순서에 따라 결과가 달라지는 사고로
# 이어질 수 있다 — 예를 들어 캐시가 이미 채워진 상태에서 "LLM 클라이언트 생성 실패" 테스트를 돌리면
# 캐시 덕분에 실제 생성 자체를 건너뛰어서 실패해야 할 job이 성공해버린다. 매 테스트 전에 비운다.
@pytest.fixture(autouse=True)
def _clear_review_cache():
    qa_jobs._review_cache.clear()
    yield


class FakeAnthropicClient:
    """Stands in for review_agent's real AnthropicClient — no network call, just enough of a
    contract (constructor kwargs + complete_json + clone()) to drive the real
    category_screen/qa_jobs wiring end to end without a live API key."""

    def __init__(
        self, model: str | None = None, api_key: str | None = None, temperature: float = 0.0, max_tokens: int = 8192
    ) -> None:
        self.model = model
        self._temperature = temperature
        self._max_tokens = max_tokens
        self.calls: list[tuple[str, str]] = []
        self.usage: list[CallStats] = []

    def clone(self, *, tier: object | None = None) -> FakeAnthropicClient:
        # category_screen.review_document() runs tiers concurrently and clones per tier —
        # this fake routes purely by prompt content, so every clone can safely be the same
        # kind of instance (a fresh one, so each tier's .calls/.usage stay separate).
        return FakeAnthropicClient(model=self.model)

    def complete_json(self, *, system: str, prompt: str) -> Any:
        self.calls.append((system, prompt))
        self.usage.append(CallStats(elapsed_seconds=0.0, prompt_tokens=None, completion_tokens=None, total_tokens=None))
        if '"summary"' in system:
            return {"summary": "결제 시스템 개선을 다루는 테스트 문서."}
        if '"candidates"' in system:
            category_match = _CATEGORY_RE.search(prompt)
            chunk_match = _CHUNK_ZERO_RE.search(prompt)
            if not category_match or not chunk_match:
                return {"candidates": []}
            quoted = chunk_match.group(1).strip().splitlines()[0][:30]
            return {
                "candidates": [
                    {"chunk_index": 0, "category": category_match.group(1), "quoted_text": quoted, "reason": "테스트 스크리닝 사유"}
                ]
            }
        if '"verdicts"' in system:
            rule_match = _RULE_ID_RE.search(prompt)
            if not rule_match:
                return {"verdicts": []}
            return {
                "verdicts": [
                    {
                        "index": 0,
                        "violated": True,
                        "rule_id": rule_match.group(1),
                        "description": "테스트로 주입된 위반 설명",
                        "rationale": "테스트로 주입된 위반 사유",
                        "fix_direction": "테스트로 주입된 수정 제안",
                    }
                ]
            }
        raise AssertionError(f"unexpected system prompt: {system[:80]}")


async def test_qa_job_runs_pipeline_and_produces_mapped_issues(monkeypatch) -> None:
    monkeypatch.setattr(qa_jobs, "AnthropicClient", FakeAnthropicClient)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        create_response = await client.post("/documents", json={"raw_text": _TEST_DOCUMENT})
        document_id = create_response.json()["document_id"]

        job_response = await client.post(f"/documents/{document_id}/qa-jobs")
        job_id = job_response.json()["job_id"]

        status_response = await client.get(f"/qa-jobs/{job_id}/status")
        issues_response = await client.get(f"/qa-jobs/{job_id}/issues")

    assert job_response.status_code == 200
    status = status_response.json()
    assert status["status"] == "done"
    assert status["progress"] == 100

    issues = issues_response.json()
    assert len(issues) > 0
    for issue in issues:
        assert issue["location"]
        assert issue["input_text"]
        assert issue["reason"] == "테스트로 주입된 위반 사유"
        assert issue["suggestion"] == "테스트로 주입된 수정 제안"
        # criteria가 원시 rule_id("TC-01" 등)가 아니라 룰북에서 찾은 사람이 읽는 카테고리 라벨인지 —
        # _to_issue_record의 rulebook 매핑이 실제로 동작하는지 확인하는 지점.
        assert not re.fullmatch(r"[A-Z]{2}-\d{2}", issue["criteria"])


async def test_qa_job_status_returns_404_for_unknown_job() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/qa-jobs/does-not-exist/status")

    assert response.status_code == 404


async def test_qa_job_create_returns_404_for_unknown_document() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post("/documents/does-not-exist/qa-jobs")

    assert response.status_code == 404


async def test_qa_job_marks_failed_when_llm_client_cannot_be_built(monkeypatch) -> None:
    # review_document() itself isolates each stage's LLM errors into tier_errors and still
    # returns a (empty) result — by design, see pipeline.py's docstring — so the only way a
    # job actually resolves to "failed" is a failure *before* the pipeline runs, e.g. no
    # Anthropic API key configured (AnthropicClient's constructor raising), mirrored here.
    class BrokenAnthropicClient:
        def __init__(self, *args: object, **kwargs: object) -> None:
            raise RuntimeError("no Anthropic API key configured")

    monkeypatch.setattr(qa_jobs, "AnthropicClient", BrokenAnthropicClient)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        create_response = await client.post("/documents", json={"raw_text": _TEST_DOCUMENT})
        document_id = create_response.json()["document_id"]

        job_response = await client.post(f"/documents/{document_id}/qa-jobs")
        job_id = job_response.json()["job_id"]

        status_response = await client.get(f"/qa-jobs/{job_id}/status")

    assert status_response.json()["status"] == "failed"


# 프레임(문서 위 하이라이트 박스) 유형 매핑 — "Ver.2 - Edit 행위별 프레임 유형 구분" 기준.
# related_location은 review-agent에 아직 없는 필드(요청: sunic5-planqa/planqa-agent#4)라
# LG/LF/GA도 값이 없으면 object로 폴백하는 것까지 같이 검증한다.
@pytest.mark.parametrize(
    ("category", "related_location", "expected"),
    [
        ("TC", None, qa_jobs.FrameType.OBJECT),
        ("TM", None, qa_jobs.FrameType.OBJECT),
        ("AE", None, qa_jobs.FrameType.OBJECT),
        ("RD", None, qa_jobs.FrameType.OBJECT),
        ("MI", None, qa_jobs.FrameType.INSERT_RANGE),
        ("MI", "3-1", qa_jobs.FrameType.INSERT_RANGE),
        ("LG", None, qa_jobs.FrameType.OBJECT),
        ("LF", None, qa_jobs.FrameType.OBJECT),
        ("GA", None, qa_jobs.FrameType.OBJECT),
        ("LG", "3-1", qa_jobs.FrameType.RANGE),
        ("LF", "2. 배경 및 문제 정의", qa_jobs.FrameType.RANGE),
        ("GA", "5-2", qa_jobs.FrameType.RANGE),
    ],
)
def test_frame_type_mapping(category: str, related_location: str | None, expected: qa_jobs.FrameType) -> None:
    assert qa_jobs._frame_type(category, related_location) == expected


# category_screen.review_document()의 4개 위계가 실제로는 동시에 도니까, 진행률 체크리스트도
# 한 그룹씩 순서대로가 아니라 모든 그룹이 같은 속도로 같이 차올라야 한다(2026-08-10).
def test_categories_for_progress_advances_every_group_together() -> None:
    rulebook = qa_jobs._load_rulebook()

    categories, _ = qa_jobs._categories_for_progress(rulebook, 50)

    assert len(categories) > 1
    done_fractions = [
        sum(1 for item in group.items if item.status == "done") / len(group.items) for group in categories
    ]
    # 그룹마다 아이템 개수가 달라 정수 반올림 오차는 있지만, 전부 비슷한 진행률(≈0.5)이어야 한다 —
    # 예전 버전이라면 한 그룹은 1.0(완료), 나머지는 0.0(대기)이었을 것.
    assert all(abs(fraction - 0.5) < 0.34 for fraction in done_fractions)


def test_categories_for_progress_marks_everything_done_at_100() -> None:
    rulebook = qa_jobs._load_rulebook()

    categories, current_category = qa_jobs._categories_for_progress(rulebook, 100)

    assert current_category is None
    assert all(item.status == "done" for group in categories for item in group.items)


async def test_qa_job_reuses_cached_result_for_identical_document_text(monkeypatch) -> None:
    # 같은 문서를 반복 검토할 때마다 실제 LLM을 다시 부르면 매번 수십 초 + 비용이 든다 — 문서
    # 텍스트가 완전히 같으면(document_id가 새로 발급돼도) 캐시에서 재사용해야 한다.
    call_count = 0

    def fake_review_document(
        doc_id: str,
        document_text: str,
        rulebook: Any,
        screen_llm: Any,
        confirm_llm: Any,
    ) -> qa_jobs.ReviewResult:
        nonlocal call_count
        call_count += 1
        issue = qa_jobs.ReviewIssue(
            doc_id=doc_id,
            level="sentence",
            rule_id="TC-01",
            location="1. 배경 및 문제 정의",
            description="설명",
            original_text="3사만 지원",
            rationale="이유",
            fix_direction="제안",
        )
        return qa_jobs.ReviewResult(doc_id=doc_id, global_context="", issues=(issue,))

    monkeypatch.setattr(qa_jobs, "review_document", fake_review_document)
    monkeypatch.setattr(qa_jobs, "AnthropicClient", FakeAnthropicClient)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        doc1 = (await client.post("/documents", json={"raw_text": _TEST_DOCUMENT})).json()["document_id"]
        job1 = (await client.post(f"/documents/{doc1}/qa-jobs")).json()["job_id"]
        status1 = (await client.get(f"/qa-jobs/{job1}/status")).json()
        issues1 = (await client.get(f"/qa-jobs/{job1}/issues")).json()

        # raw_text가 같아도 /documents는 매번 새 document_id를 발급한다 — 캐시는 document_id가
        # 아니라 문서 "내용" 기준이어야 이 경우도 재사용된다.
        doc2 = (await client.post("/documents", json={"raw_text": _TEST_DOCUMENT})).json()["document_id"]
        job2 = (await client.post(f"/documents/{doc2}/qa-jobs")).json()["job_id"]
        status2 = (await client.get(f"/qa-jobs/{job2}/status")).json()
        issues2 = (await client.get(f"/qa-jobs/{job2}/issues")).json()

    assert status1["status"] == "done"
    assert status2["status"] == "done"
    assert call_count == 1
    assert len(issues1) == 1
    assert len(issues2) == 1
    # 각 job 소유의 별개 레코드로 저장되는지(캐시된 원본을 공유 참조하는 게 아니라) 확인.
    assert issues1[0]["id"] != issues2[0]["id"]


async def test_qa_job_does_not_use_cache_for_a_different_document(monkeypatch) -> None:
    call_count = 0

    def fake_review_document(
        doc_id: str,
        document_text: str,
        rulebook: Any,
        screen_llm: Any,
        confirm_llm: Any,
    ) -> qa_jobs.ReviewResult:
        nonlocal call_count
        call_count += 1
        return qa_jobs.ReviewResult(doc_id=doc_id, global_context="", issues=())

    monkeypatch.setattr(qa_jobs, "review_document", fake_review_document)
    monkeypatch.setattr(qa_jobs, "AnthropicClient", FakeAnthropicClient)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        doc1 = (await client.post("/documents", json={"raw_text": _TEST_DOCUMENT})).json()["document_id"]
        job1 = (await client.post(f"/documents/{doc1}/qa-jobs")).json()["job_id"]
        await client.get(f"/qa-jobs/{job1}/status")

        doc2 = (await client.post("/documents", json={"raw_text": _TEST_DOCUMENT + "\n다른 내용"})).json()["document_id"]
        job2 = (await client.post(f"/documents/{doc2}/qa-jobs")).json()["job_id"]
        await client.get(f"/qa-jobs/{job2}/status")

    assert call_count == 2
