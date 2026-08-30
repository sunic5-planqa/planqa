from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from anthropic import AsyncAnthropic
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from sunnic_backend.api import documents, issues, qa_jobs, rulebook, teams
from sunnic_backend.config import settings


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    app.state.anthropic_client = AsyncAnthropic(api_key=settings.anthropic_api_key or "not-set")
    yield
    await app.state.anthropic_client.close()


app = FastAPI(title="써니C Backend", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(documents.router)
app.include_router(qa_jobs.router)
app.include_router(issues.router)
app.include_router(teams.router)
app.include_router(rulebook.router)


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}
