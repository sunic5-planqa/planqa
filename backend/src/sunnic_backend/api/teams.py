import secrets
import string
import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from sunnic_backend.models.team import Team
from sunnic_backend.models.team_rule import TeamRule, TeamRuleExamples
from sunnic_backend.storage.store import store

router = APIRouter(tags=["teams"])

_CODE_ALPHABET = string.ascii_uppercase + string.digits
_CODE_LENGTH = 6


class CreateTeamRequest(BaseModel):
    team_name: str
    description: str


class TeamResponse(BaseModel):
    team_code: str
    team_name: str
    description: str


class TeamRuleIn(BaseModel):
    rule_name: str
    description: str
    exception_text: str | None = None
    examples: TeamRuleExamples = TeamRuleExamples()
    enabled: bool = True


class TeamRuleResponse(BaseModel):
    id: str
    rule_name: str
    description: str
    exception_text: str | None
    examples: TeamRuleExamples
    enabled: bool


def _to_response(rule: TeamRule) -> TeamRuleResponse:
    return TeamRuleResponse(
        id=rule.id,
        rule_name=rule.rule_name,
        description=rule.description,
        exception_text=rule.exception_text,
        examples=rule.examples,
        enabled=rule.enabled,
    )


async def _generate_unique_team_code() -> str:
    for _ in range(10):
        code = "".join(secrets.choice(_CODE_ALPHABET) for _ in range(_CODE_LENGTH))
        if await store.get_team(code) is None:
            return code
    raise HTTPException(status_code=500, detail="failed to generate a unique team code")


async def _get_team_or_404(team_code: str) -> Team:
    team = await store.get_team(team_code)
    if team is None:
        raise HTTPException(status_code=404, detail="team not found")
    return team


async def _get_team_rule_or_404(team_code: str, rule_id: str) -> TeamRule:
    rule = await store.get_team_rule(rule_id)
    if rule is None or rule.team_code != team_code:
        raise HTTPException(status_code=404, detail="team rule not found")
    return rule


@router.post("/teams", response_model=TeamResponse)
async def create_team(request: CreateTeamRequest) -> TeamResponse:
    team = Team(
        team_code=await _generate_unique_team_code(),
        team_name=request.team_name,
        description=request.description,
    )
    await store.save_team(team)
    return TeamResponse(**team.model_dump())


@router.get("/teams/{team_code}", response_model=TeamResponse)
async def get_team(team_code: str) -> TeamResponse:
    team = await _get_team_or_404(team_code)
    return TeamResponse(**team.model_dump())


@router.get("/teams/{team_code}/rules", response_model=list[TeamRuleResponse])
async def list_team_rules(team_code: str) -> list[TeamRuleResponse]:
    await _get_team_or_404(team_code)
    rules = await store.list_team_rules_for_team(team_code)
    return [_to_response(rule) for rule in rules]


@router.post("/teams/{team_code}/rules", response_model=TeamRuleResponse)
async def create_team_rule(team_code: str, request: TeamRuleIn) -> TeamRuleResponse:
    await _get_team_or_404(team_code)
    rule = TeamRule(
        id=str(uuid.uuid4()),
        team_code=team_code,
        rule_name=request.rule_name,
        description=request.description,
        exception_text=request.exception_text,
        examples=request.examples,
        enabled=request.enabled,
    )
    await store.save_team_rule(rule)
    return _to_response(rule)


@router.patch("/teams/{team_code}/rules/{rule_id}", response_model=TeamRuleResponse)
async def update_team_rule(team_code: str, rule_id: str, request: TeamRuleIn) -> TeamRuleResponse:
    existing = await _get_team_rule_or_404(team_code, rule_id)
    updated = existing.model_copy(
        update={
            "rule_name": request.rule_name,
            "description": request.description,
            "exception_text": request.exception_text,
            "examples": request.examples,
            "enabled": request.enabled,
        }
    )
    await store.save_team_rule(updated)
    return _to_response(updated)


@router.delete("/teams/{team_code}/rules/{rule_id}")
async def delete_team_rule(team_code: str, rule_id: str) -> dict[str, str]:
    await _get_team_rule_or_404(team_code, rule_id)
    await store.delete_team_rule(rule_id)
    return {"id": rule_id}
