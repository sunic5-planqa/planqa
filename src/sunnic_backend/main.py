from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from anthropic import AsyncAnthropic
from fastapi import FastAPI

from sunnic_backend.api import documents, issues, qa_jobs
from sunnic_backend.config import settings


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    app.state.anthropic_client = AsyncAnthropic(api_key=settings.anthropic_api_key or "not-set")
    yield
    await app.state.anthropic_client.close()


app = FastAPI(title="써니C Backend", lifespan=lifespan)

app.include_router(documents.router)
app.include_router(qa_jobs.router)
app.include_router(issues.router)


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}
