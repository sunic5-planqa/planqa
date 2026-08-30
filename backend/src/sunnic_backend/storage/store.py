import asyncio
import sqlite3
from pathlib import Path

from sunnic_backend.models.document import Document
from sunnic_backend.models.issue import Issue
from sunnic_backend.models.qa_job import QAJob

# Only `documents` needs to survive a backend restart — the "QA 통과" badge (issue #6, 2026-08-30)
# looks up a Confluence page's pass/fail status by `confluence_page_id`, which must outlive the
# in-memory process that ran the review. `qa_jobs`/`issues` stay plain dicts: they're scoped to one
# review session and nothing asks them to persist across restarts.
_DB_PATH = Path(__file__).resolve().parents[3] / "data" / "sunnic.db"


class Store:
    def __init__(self, db_path: Path = _DB_PATH) -> None:
        self._lock = asyncio.Lock()
        self._qa_jobs: dict[str, QAJob] = {}
        self._issues: dict[str, Issue] = {}

        db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(db_path)
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS documents (
                id TEXT PRIMARY KEY,
                confluence_page_id TEXT,
                qa_passed INTEGER NOT NULL DEFAULT 0,
                data TEXT NOT NULL
            )
            """
        )
        self._conn.execute("CREATE INDEX IF NOT EXISTS idx_documents_page ON documents(confluence_page_id)")
        self._conn.commit()

    async def save_document(self, document: Document) -> None:
        async with self._lock:
            self._conn.execute(
                "INSERT OR REPLACE INTO documents (id, confluence_page_id, qa_passed, data) VALUES (?, ?, ?, ?)",
                (document.id, document.confluence_page_id, int(document.qa_passed), document.model_dump_json()),
            )
            self._conn.commit()

    async def get_document(self, document_id: str) -> Document | None:
        async with self._lock:
            row = self._conn.execute("SELECT data FROM documents WHERE id = ?", (document_id,)).fetchone()
            return Document.model_validate_json(row[0]) if row else None

    async def count_documents(self) -> int:
        async with self._lock:
            (count,) = self._conn.execute("SELECT COUNT(*) FROM documents").fetchone()
            return count

    # Most-recently-saved document for a Confluence page, keyed by `confluence_page_id` rather
    # than the ephemeral per-session `id` — `rowid` tracks insertion/replace order in sqlite, so
    # DESC gives the latest review for that page. Returns None if that page was never reviewed.
    async def get_latest_qa_status_for_page(self, confluence_page_id: str) -> bool | None:
        async with self._lock:
            row = self._conn.execute(
                "SELECT qa_passed FROM documents WHERE confluence_page_id = ? ORDER BY rowid DESC LIMIT 1",
                (confluence_page_id,),
            ).fetchone()
            return bool(row[0]) if row else None

    async def save_qa_job(self, job: QAJob) -> None:
        async with self._lock:
            self._qa_jobs[job.id] = job

    async def get_qa_job(self, job_id: str) -> QAJob | None:
        async with self._lock:
            return self._qa_jobs.get(job_id)

    async def save_issue(self, issue: Issue) -> None:
        async with self._lock:
            self._issues[issue.id] = issue

    async def get_issue(self, issue_id: str) -> Issue | None:
        async with self._lock:
            return self._issues.get(issue_id)

    async def list_issues_for_job(self, job_id: str) -> list[Issue]:
        async with self._lock:
            return [issue for issue in self._issues.values() if issue.job_id == job_id]


store = Store()
