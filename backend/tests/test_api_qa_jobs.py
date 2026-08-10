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

# bundled_screen_hybrid's screen AND confirm prompts both embed each rule via _hybrid_block
# as a "  {rule_id} ({category_label}): {text}" line — same regex extracts the first rule
# mentioned in either phase's prompt.
_RULE_ID_LINE_RE = re.compile(r"^\s*([A-Z]{2}-\d{2})\s*\(", re.MULTILINE)
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
    contract (constructor kwargs + complete_json) to drive the real
    bundled_screen_hybrid/qa_jobs wiring end to end without a live API key."""

    def __init__(
        self, model: str | None = None, api_key: str | None = None, temperature: float = 0.0, max_tokens: int = 8192
    ) -> None:
        self.model = model
        self._temperature = temperature
        self._max_tokens = max_tokens
        self.calls: list[tuple[str, str]] = []
        self.usage: list[CallStats] = []

    def complete_json(self, *, system: str, prompt: str, cache_prefix: str | None = None) -> Any:
        self.calls.append((system, prompt))
        self.usage.append(CallStats(elapsed_seconds=0.0, prompt_tokens=None, completion_tokens=None, total_tokens=None))
        if '"summary"' in system:
            return {"summary": "결제 시스템 개선을 다루는 테스트 문서."}
        if '"actually_missing"' in system:
            # _verify_mi_finding's follow-up check — whichever rule the rulebook happens to
            # list first for this document may or may not be MI, so this test double must
            # handle it regardless (dedicated tests exercise the actual filtering behavior).
            return {"actually_missing": True, "reason": "테스트 더블 기본 응답"}
        if '"candidates"' in system:
            rule_match = _RULE_ID_LINE_RE.search(prompt)
            chunk_match = _CHUNK_ZERO_RE.search(prompt)
            if not rule_match or not chunk_match:
                return {"candidates": []}
            quoted = chunk_match.group(1).strip().splitlines()[0][:30]
            return {
                "candidates": [
                    {"chunk_index": 0, "rule_id": rule_match.group(1), "quoted_text": quoted, "reason": "테스트 스크리닝 사유"}
                ]
            }
        if '"verdicts"' in system:
            rule_match = _RULE_ID_LINE_RE.search(prompt)
            if not rule_match:
                return {"verdicts": []}
            return {
                "verdicts": [
                    {
                        "index": 0,
                        "violated": True,
                        "original_text": "테스트로 주입된 인용문",
                        "description": "테스트로 주입된 위반 설명",
                        "rationale": "테스트로 주입된 위반 사유",
                        "fix_direction": "테스트로 주입된 수정 제안",
                        "excused": False,
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


# bundled_screen_hybrid.review_document()의 두 패스(Paragraph/Document)는 다시 동시 실행이라
# (2026-08-10 review-agent 자체 병렬화 업데이트 — 잠깐 순차였다가 되돌아감), 진행률 체크리스트도
# 한 그룹씩 순서대로가 아니라 모든 그룹이 같은 속도로 같이 차올라야 한다.
def test_categories_for_progress_advances_every_group_together() -> None:
    rulebook = qa_jobs._load_rulebook()

    categories, _ = qa_jobs._categories_for_progress(rulebook, 50)

    assert len(categories) > 1
    done_fractions = [
        sum(1 for item in group.items if item.status == "done") / len(group.items) for group in categories
    ]
    # 그룹마다 아이템 개수가 달라 정수 반올림 오차는 있지만, 전부 비슷한 진행률(≈0.5)이어야 한다 —
    # 순차 실행 버전이라면 한 그룹은 1.0(완료), 나머지는 0.0(대기)이었을 것.
    assert all(abs(fraction - 0.5) < 0.34 for fraction in done_fractions)


def test_categories_for_progress_marks_everything_done_at_100() -> None:
    rulebook = qa_jobs._load_rulebook()

    categories, current_category = qa_jobs._categories_for_progress(rulebook, 100)

    assert current_category is None
    assert all(item.status == "done" for group in categories for item in group.items)


# Logical Unit은 bundled_screen_hybrid가 직접 dispatch하는 패스는 아니지만(Paragraph/Document
# 청크만 모델에 던짐), confirm이 resolve_reported_level로 승격시키면 실제 Issue.level에 찍히는
# 값이라 rulebook_v1.0.md §2 기준으로는 실재하는 위계다 — 체크리스트에도 세 번째 그룹으로 보여야 함.
def test_build_tier_groups_includes_all_three_tiers() -> None:
    rulebook = qa_jobs._load_rulebook()

    groups = qa_jobs._build_tier_groups(rulebook)

    group_keys = [key for key, _label, _items in groups]
    assert group_keys == ["document", "logical_unit", "paragraph"]


def test_build_tier_groups_logical_unit_covers_every_category() -> None:
    # tiers.TIER_CATEGORIES[Level.LOGICAL_UNIT]는 8개 카테고리 전부를 커버한다(rulebook §2 기준)
    # — Document/Paragraph 그룹에 이미 나온 카테고리라도 Logical Unit에 다시 나오는 게 정상이다.
    rulebook = qa_jobs._load_rulebook()

    groups = qa_jobs._build_tier_groups(rulebook)
    by_key = {key: items for key, _label, items in groups}
    logical_unit_categories = {prefix for prefix, _label in by_key["logical_unit"]}

    all_categories = {rule.category for rule in rulebook.rules.values()}
    assert logical_unit_categories == all_categories


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


class _StubVerifyLLM:
    def __init__(self, response: Any | None) -> None:
        self._response = response
        self.calls: list[tuple[str, str]] = []

    def complete_json(self, *, system: str, prompt: str, cache_prefix: str | None = None) -> Any:
        self.calls.append((system, prompt))
        if self._response is None:
            raise RuntimeError("boom")
        return self._response


def _mi_issue(original_text: str = "목표 런칭일: - QA 기간: ~") -> qa_jobs.ReviewIssue:
    return qa_jobs.ReviewIssue(
        doc_id="DOC-TEST",
        level="Paragraph",
        rule_id="MI-01",
        location="8. 런칭 계획",
        description="런칭일/QA 기간이 구체적으로 명시되지 않음",
        original_text=original_text,
        rationale="시간 조건이 정의되지 않음",
    )


# MI(정보 누락) 카테고리에서 문서에 실제로 있는 정보를 "없다"고 잘못 주장하는 오탐이 실사용 중
# 확인됨(DOC-001 "8. 런칭 계획"의 날짜) — confirm이 좁은 chunk만 보고 판단한 게 원인으로 보여,
# 문서 전체를 다시 보여주고 재확인하는 검증 단계를 추가함.
def test_verify_mi_finding_keeps_the_issue_when_verification_confirms_it_is_missing() -> None:
    llm = _StubVerifyLLM({"actually_missing": True, "reason": "정말 없음"})

    assert qa_jobs._verify_mi_finding("문서 전문", _mi_issue(), llm) is True


def test_verify_mi_finding_drops_the_issue_when_verification_finds_it_present() -> None:
    llm = _StubVerifyLLM({"actually_missing": False, "reason": "8장에 날짜가 있음"})

    assert qa_jobs._verify_mi_finding("문서 전문", _mi_issue(), llm) is False


def test_verify_mi_finding_fails_safe_by_keeping_the_issue_on_llm_error() -> None:
    llm = _StubVerifyLLM(None)

    assert qa_jobs._verify_mi_finding("문서 전문", _mi_issue(), llm) is True


def test_verify_mi_finding_fails_safe_on_malformed_response() -> None:
    llm = _StubVerifyLLM("not a dict")

    assert qa_jobs._verify_mi_finding("문서 전문", _mi_issue(), llm) is True


def test_run_review_sync_drops_mi_false_positive_but_keeps_other_issues(monkeypatch) -> None:
    mi_issue = _mi_issue()
    other_issue = qa_jobs.ReviewIssue(
        doc_id="DOC-TEST",
        level="Paragraph",
        rule_id="TC-01",
        location="1. 목적",
        description="d",
        original_text="x",
        rationale="r",
    )

    def fake_review_document(doc_id, document_text, rulebook, screen_llm, confirm_llm):
        return qa_jobs.ReviewResult(doc_id=doc_id, global_context="", issues=(mi_issue, other_issue))

    verify_calls: list[str] = []

    class _FakeConfirmClient(FakeAnthropicClient):
        def complete_json(self, *, system: str, prompt: str, cache_prefix: str | None = None) -> Any:
            if '"actually_missing"' in system:
                verify_calls.append(prompt)
                return {"actually_missing": False, "reason": "실제로는 문서에 있음"}
            return super().complete_json(system=system, prompt=prompt, cache_prefix=cache_prefix)

    monkeypatch.setattr(qa_jobs, "review_document", fake_review_document)
    monkeypatch.setattr(qa_jobs, "AnthropicClient", _FakeConfirmClient)

    rulebook = qa_jobs._load_rulebook()
    result = qa_jobs._run_review_sync("DOC-TEST", _TEST_DOCUMENT, rulebook)

    assert [issue.rule_id for issue in result.issues] == ["TC-01"]
    assert len(verify_calls) == 1
    assert _TEST_DOCUMENT in verify_calls[0]


def _issue(rule_id: str, location: str, original_text: str | None) -> qa_jobs.ReviewIssue:
    return qa_jobs.ReviewIssue(
        doc_id="DOC-TEST",
        level="Paragraph",
        rule_id=rule_id,
        location=location,
        description="d",
        original_text=original_text,
        rationale="r",
    )


# 같은 문구(위치+인용문)에 서로 다른 카테고리의 룰이 동시에 걸리는 경우(실사용 중 확인됨 — "용어
# 오용"과 "상위 목표와의 정합성"이 완전히 같은 입력내용을 가리킴), 더 시급한 카테고리 하나만 남긴다.
def test_dedupe_conflicting_categories_keeps_the_higher_priority_one() -> None:
    rulebook = qa_jobs._load_rulebook()
    tm_issue = _issue("TM-01", "6. FAQ", "Q. 당일 배송은 어떤 지역에서 가능한가요?")
    ga_issue = _issue("GA-01", "6. FAQ", "Q. 당일 배송은 어떤 지역에서 가능한가요?")

    kept = qa_jobs._dedupe_conflicting_categories((tm_issue, ga_issue), rulebook)

    assert [issue.rule_id for issue in kept] == ["GA-01"]


def test_dedupe_conflicting_categories_keeps_higher_priority_regardless_of_input_order() -> None:
    rulebook = qa_jobs._load_rulebook()
    ga_issue = _issue("GA-01", "6. FAQ", "같은 문구")
    tm_issue = _issue("TM-01", "6. FAQ", "같은 문구")

    kept = qa_jobs._dedupe_conflicting_categories((ga_issue, tm_issue), rulebook)

    assert [issue.rule_id for issue in kept] == ["GA-01"]


def test_dedupe_conflicting_categories_keeps_both_when_location_or_text_differs() -> None:
    rulebook = qa_jobs._load_rulebook()
    a = _issue("TM-01", "6. FAQ", "문구 A")
    b = _issue("GA-01", "7. 마일스톤", "문구 A")
    c = _issue("TC-01", "6. FAQ", "문구 B")

    kept = qa_jobs._dedupe_conflicting_categories((a, b, c), rulebook)

    assert {issue.rule_id for issue in kept} == {"TM-01", "GA-01", "TC-01"}


def test_dedupe_conflicting_categories_never_collapses_issues_without_a_quote() -> None:
    # MI(정보 누락)처럼 인용문이 없는 이슈는 "같은 문구"인지 판단할 근거가 없어 손대지 않는다.
    rulebook = qa_jobs._load_rulebook()
    a = _issue("MI-01", "6. FAQ", None)
    b = _issue("MI-02", "6. FAQ", None)

    kept = qa_jobs._dedupe_conflicting_categories((a, b), rulebook)

    assert {issue.rule_id for issue in kept} == {"MI-01", "MI-02"}
