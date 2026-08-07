import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from sunnic_backend.models.document import Document, ParsedStructure
from sunnic_backend.parsing.markdown_structure import parse_markdown
from sunnic_backend.storage.store import store

router = APIRouter(tags=["documents"])


class CreateDocumentRequest(BaseModel):
    raw_text: str


class CreateDocumentResponse(BaseModel):
    document_id: str
    parsed_structure: ParsedStructure


class DocumentCountResponse(BaseModel):
    count: int


@router.post("/documents", response_model=CreateDocumentResponse)
async def create_document(request: CreateDocumentRequest) -> CreateDocumentResponse:
    parsed_structure = parse_markdown(request.raw_text)
    document = Document(
        id=str(uuid.uuid4()),
        raw_text=request.raw_text,
        working_text=request.raw_text,
        parsed_structure=parsed_structure,
    )
    await store.save_document(document)
    return CreateDocumentResponse(document_id=document.id, parsed_structure=parsed_structure)


# 사이드패널의 "AI QA Service으로 N건의 문서가 검토됐어요" 문구용 — 실제 QA 완료 여부와 무관하게
# 지금은 "리뷰가 시작된 문서 수"(POST /documents 호출 횟수)로 근사한다. QA 엔진이 생기면 "완료된"
# 검토 기준으로 바꿔야 더 정확함. in-memory 저장소라 서버 재시작 시 0으로 리셋된다.
@router.get("/documents/count", response_model=DocumentCountResponse)
async def count_documents() -> DocumentCountResponse:
    return DocumentCountResponse(count=await store.count_documents())


@router.get("/documents/{document_id}/export")
async def export_document(document_id: str) -> dict[str, str]:
    document = await store.get_document(document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="document not found")
    raise HTTPException(status_code=501, detail="export is not implemented yet")
