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


@router.get("/documents/{document_id}/export")
async def export_document(document_id: str) -> dict[str, str]:
    document = await store.get_document(document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="document not found")
    raise HTTPException(status_code=501, detail="export is not implemented yet")
