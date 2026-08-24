from fastapi import APIRouter
from pydantic import BaseModel

from sunnic_backend.api.qa_jobs import _korean_label, _load_rulebook

router = APIRouter(tags=["rulebook"])


class RulebookCategoryResponse(BaseModel):
    category: str
    label: str


@router.get("/rulebook/categories", response_model=list[RulebookCategoryResponse])
async def list_rulebook_categories() -> list[RulebookCategoryResponse]:
    rulebook = _load_rulebook()
    labels: dict[str, str] = {}
    for rule in rulebook.rules.values():
        labels.setdefault(rule.category, _korean_label(rule.category_label))
    return [RulebookCategoryResponse(category=category, label=labels[category]) for category in rulebook.categories]
