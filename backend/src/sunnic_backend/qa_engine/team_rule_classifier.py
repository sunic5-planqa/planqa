from __future__ import annotations

from sunnic_backend.models.team_rule import TeamRuleScope
from sunnic_backend.qa_engine.review_agent.llm.base import LLMClient

# 팀 룰 저장(생성/수정) 시점에 딱 1번 호출 — QA 실행마다가 아니라 룰 자체가 바뀔 때만 재분류.
# 유사도/임베딩 매칭이 아니라 LLM 분류를 쓰는 이유: "관계형이냐"는 룰의 토픽이 아니라 구조("두
# 위치를 비교해야 하는가")의 문제라, 기존 룰 예시와의 표면적 유사도로는 잘 안 맞는다 — 예를
# 들어 "환불 정책 두 문서 위치가 일치해야 한다"는 GA의 기존 예시(전환율 KPI 등)와 토픽은
# 전혀 안 겹치지만 구조는 명백히 relational이다.
_CLASSIFY_SYSTEM = (
    "You classify a custom QA rule (written by a non-technical team lead in Korean) by its "
    "STRUCTURE, not its topic — this determines which pass of the review pipeline the rule "
    "runs in, so getting the structural shape right matters more than what the rule is "
    "actually about. Pick exactly one:\n"
    '- "paragraph": the rule can be judged by reading ONE passage/section in isolation — '
    "most rules are this (e.g. \"don't use word X\", \"always state the deadline\", \"this "
    "term must mean Y\").\n"
    '- "relational": judging the rule requires comparing TWO DIFFERENT locations elsewhere '
    "in the same document against each other for a conflict — e.g. \"the refund period "
    "stated in the policy section must match the one in the FAQ section\", \"a feature "
    "listed in the requirements must also appear in the milestone list\".\n"
    '- "absence_check": judging the rule requires scanning the ENTIRE document to confirm '
    "something is (or is never) stated ANYWHERE at all — not comparing two specific spots, "
    "just a document-wide existence check — e.g. \"every claim must be backed by a traceable "
    "reason somewhere in the document\", \"every abbreviation must be defined on first use\".\n"
    "When genuinely unsure, prefer \"paragraph\" — it's the safe default and correctly "
    "describes the vast majority of real rules.\n"
    'Respond with JSON only: {"scope": "paragraph" | "relational" | "absence_check"}'
)

_VALID_SCOPES: frozenset[TeamRuleScope] = frozenset({"paragraph", "relational", "absence_check"})


def classify_scope(rule_name: str, description: str, exception_text: str | None, llm: LLMClient) -> TeamRuleScope:
    prompt = (
        f"Rule name: {rule_name}\nDescription: {description}\nException condition: {exception_text or '(none)'}\n\n"
        "Return the JSON."
    )
    try:
        response = llm.complete_json(system=_CLASSIFY_SYSTEM, prompt=prompt)
    except Exception:  # noqa: BLE001 - a classification failure must not block saving the rule
        return "paragraph"
    scope = response.get("scope") if isinstance(response, dict) else None
    return scope if scope in _VALID_SCOPES else "paragraph"
