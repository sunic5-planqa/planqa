from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime
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


# 문서 본문 순서로 이슈를 내려주려면(SCREEN 02 "다음"/오버뷰가 왼쪽 원본을 위→아래로 훑도록) 각
# 이슈가 document_text 안 어디쯤인지 알아야 한다.
def test_issue_start_prefers_input_text_position() -> None:
    document_text = "머리말\n\n## 1장\n\n본문 문장입니다.\n\n## 2장\n\n다른 문장.\n"

    assert qa_jobs._issue_start(document_text, "다른 문장", "2장") == document_text.index("다른 문장")


def test_issue_start_falls_back_to_location_heading_when_input_text_missing() -> None:
    # 정보 누락(MI) 이슈는 input_text가 원래 빈 문자열이다 — 그 위계의 제목으로라도 위치를 잡아야
    # 정렬했을 때 맨 앞으로 쏠리지 않는다.
    document_text = "머리말\n\n## 1장\n\n본문.\n\n## 2장\n\n다른 문장.\n"

    assert qa_jobs._issue_start(document_text, "", "1장 > 2장") == document_text.index("2장")


def test_issue_start_falls_back_to_end_of_document_when_nothing_matches() -> None:
    # 못 찾았다고 0(맨 앞)으로 보내면 실제로는 후반부 이슈인데 항상 첫 번째로 나와버려 순서 왜곡이
    # 더 커진다 — 그래서 맨 뒤로 보낸다.
    document_text = "머리말\n\n본문.\n"

    assert qa_jobs._issue_start(document_text, "", "존재하지 않는 제목") == len(document_text)


async def test_qa_job_issues_are_sorted_by_position_in_the_document() -> None:
    # 파이프라인이 위계(tier)별로 병렬 처리하며 저장한 순서(뒤죽박죽)가 아니라, 문서 본문에서
    # 실제로 나타나는 순서로 내려줘야 SCREEN 02의 "다음"/오버뷰가 왼쪽 원본을 위→아래로 훑는다.
    job = qa_jobs.QAJob(
        id=str(uuid.uuid4()),
        document_id="doc-order",
        status=qa_jobs.QAJobStatus.DONE,
        progress=100,
        current_category=None,
        started_at=datetime.now(UTC),
    )
    await qa_jobs.store.save_qa_job(job)

    def make_issue(issue_id: str, start: int) -> qa_jobs.IssueRecord:
        return qa_jobs.IssueRecord(
            id=issue_id,
            job_id=job.id,
            location="위치",
            input_text="문구",
            criteria="기준",
            reason="이유",
            suggestion="제안",
            status=qa_jobs.IssueStatus.PENDING,
            edited_text=None,
            start=start,
            end=start + 2,
        )

    # 저장은 뒤죽박죽 순서로(실제 파이프라인이 tier별 병렬 처리 후 붙이는 순서를 흉내).
    await qa_jobs.store.save_issue(make_issue("late", 500))
    await qa_jobs.store.save_issue(make_issue("early", 10))
    await qa_jobs.store.save_issue(make_issue("middle", 200))

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(f"/qa-jobs/{job.id}/issues")

    ids = [issue["id"] for issue in response.json()]
    assert ids == ["early", "middle", "late"]
