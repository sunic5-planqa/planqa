import asyncio
import sqlite3
from pathlib import Path

import asyncpg

from sunnic_backend.config import settings
from sunnic_backend.models.document import Document
from sunnic_backend.models.issue import Issue
from sunnic_backend.models.qa_job import QAJob
from sunnic_backend.models.team import Team
from sunnic_backend.models.team_rule import TeamRule

# documents/teams/team_rules must survive a backend restart — the "QA 통과" badge (issue #6,
# 2026-08-30) looks up a Confluence page's pass/fail status by `confluence_page_id`, and team
# codes/rules are things teammates create once and expect to keep using. `qa_jobs`/`issues` stay
# plain dicts on Store itself: they're scoped to one review session and nothing asks them to
# persist across restarts.
#
# Backend is picked by DATABASE_URL (see config.py) — a Postgres connection string (e.g. from
# Neon/Supabase) makes this redeploy-safe, which matters on Render's free plan: its filesystem is
# ephemeral, so the SQLite file below gets wiped on every deploy there. Leave DATABASE_URL unset
# for the zero-config local SQLite file every teammate already gets by default; local dev/tests
# never need a DB signed up just to run.
_DB_PATH = Path(__file__).resolve().parents[3] / "data" / "sunnic.db"


class _SqliteBackend:
    def __init__(self, db_path: Path = _DB_PATH) -> None:
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(db_path)
        self._conn.execute(
            "CREATE TABLE IF NOT EXISTS documents ("
            "id TEXT PRIMARY KEY, confluence_page_id TEXT, qa_passed INTEGER NOT NULL DEFAULT 0, "
            "data TEXT NOT NULL)"
        )
        self._conn.execute("CREATE INDEX IF NOT EXISTS idx_documents_page ON documents(confluence_page_id)")
        self._conn.execute("CREATE TABLE IF NOT EXISTS teams (team_code TEXT PRIMARY KEY, data TEXT NOT NULL)")
        self._conn.execute(
            "CREATE TABLE IF NOT EXISTS team_rules ("
            "id TEXT PRIMARY KEY, team_code TEXT NOT NULL, data TEXT NOT NULL)"
        )
        self._conn.execute("CREATE INDEX IF NOT EXISTS idx_team_rules_team ON team_rules(team_code)")
        self._conn.commit()

    async def save_document(self, document: Document) -> None:
        self._conn.execute(
            "INSERT OR REPLACE INTO documents (id, confluence_page_id, qa_passed, data) VALUES (?, ?, ?, ?)",
            (document.id, document.confluence_page_id, int(document.qa_passed), document.model_dump_json()),
        )
        self._conn.commit()

    async def get_document(self, document_id: str) -> Document | None:
        row = self._conn.execute("SELECT data FROM documents WHERE id = ?", (document_id,)).fetchone()
        return Document.model_validate_json(row[0]) if row else None

    async def count_documents(self) -> int:
        (count,) = self._conn.execute("SELECT COUNT(*) FROM documents").fetchone()
        return count

    # Most-recently-saved document for a Confluence page, keyed by `confluence_page_id` rather
    # than the ephemeral per-session `id` — `rowid` tracks insertion/replace order in sqlite, so
    # DESC gives the latest review for that page. Returns None if that page was never reviewed.
    async def get_latest_qa_status_for_page(self, confluence_page_id: str) -> bool | None:
        row = self._conn.execute(
            "SELECT qa_passed FROM documents WHERE confluence_page_id = ? ORDER BY rowid DESC LIMIT 1",
            (confluence_page_id,),
        ).fetchone()
        return bool(row[0]) if row else None

    async def save_team(self, team: Team) -> None:
        self._conn.execute(
            "INSERT OR REPLACE INTO teams (team_code, data) VALUES (?, ?)",
            (team.team_code, team.model_dump_json()),
        )
        self._conn.commit()

    async def save_team_if_new(self, team: Team) -> bool:
        try:
            self._conn.execute(
                "INSERT INTO teams (team_code, data) VALUES (?, ?)", (team.team_code, team.model_dump_json())
            )
        except sqlite3.IntegrityError:
            return False
        self._conn.commit()
        return True

    async def get_team(self, team_code: str) -> Team | None:
        row = self._conn.execute("SELECT data FROM teams WHERE team_code = ?", (team_code,)).fetchone()
        return Team.model_validate_json(row[0]) if row else None

    async def save_team_rule(self, rule: TeamRule) -> None:
        self._conn.execute(
            "INSERT OR REPLACE INTO team_rules (id, team_code, data) VALUES (?, ?, ?)",
            (rule.id, rule.team_code, rule.model_dump_json()),
        )
        self._conn.commit()

    async def get_team_rule(self, rule_id: str) -> TeamRule | None:
        row = self._conn.execute("SELECT data FROM team_rules WHERE id = ?", (rule_id,)).fetchone()
        return TeamRule.model_validate_json(row[0]) if row else None

    async def list_team_rules_for_team(self, team_code: str) -> list[TeamRule]:
        rows = self._conn.execute("SELECT data FROM team_rules WHERE team_code = ?", (team_code,)).fetchall()
        return [TeamRule.model_validate_json(row[0]) for row in rows]

    async def delete_team_rule(self, rule_id: str) -> bool:
        cursor = self._conn.execute("DELETE FROM team_rules WHERE id = ?", (rule_id,))
        self._conn.commit()
        return cursor.rowcount > 0


class _PostgresBackend:
    # Pool creation is a coroutine, so it can't happen in __init__ (Store() is constructed
    # synchronously at module import time, before an event loop exists) — every method lazily
    # connects on first use instead, guarded by a lock so concurrent first-callers don't each
    # open their own pool.
    def __init__(self, dsn: str) -> None:
        self._dsn = dsn
        self._pool: asyncpg.Pool | None = None
        self._connect_lock = asyncio.Lock()

    async def _ensure_pool(self) -> asyncpg.Pool:
        if self._pool is not None:
            return self._pool
        async with self._connect_lock:
            if self._pool is None:
                pool = await asyncpg.create_pool(self._dsn, min_size=1, max_size=5)
                async with pool.acquire() as conn:
                    await conn.execute(
                        "CREATE TABLE IF NOT EXISTS documents ("
                        "id TEXT PRIMARY KEY, confluence_page_id TEXT, qa_passed BOOLEAN NOT NULL DEFAULT FALSE, "
                        "data TEXT NOT NULL, saved_at BIGSERIAL)"
                    )
                    await conn.execute(
                        "CREATE INDEX IF NOT EXISTS idx_documents_page ON documents(confluence_page_id)"
                    )
                    await conn.execute("CREATE TABLE IF NOT EXISTS teams (team_code TEXT PRIMARY KEY, data TEXT NOT NULL)")
                    await conn.execute(
                        "CREATE TABLE IF NOT EXISTS team_rules ("
                        "id TEXT PRIMARY KEY, team_code TEXT NOT NULL, data TEXT NOT NULL)"
                    )
                    await conn.execute("CREATE INDEX IF NOT EXISTS idx_team_rules_team ON team_rules(team_code)")
                self._pool = pool
        return self._pool

    async def save_document(self, document: Document) -> None:
        pool = await self._ensure_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                "INSERT INTO documents (id, confluence_page_id, qa_passed, data) VALUES ($1, $2, $3, $4) "
                "ON CONFLICT (id) DO UPDATE SET "
                "confluence_page_id = EXCLUDED.confluence_page_id, qa_passed = EXCLUDED.qa_passed, "
                "data = EXCLUDED.data, saved_at = DEFAULT",
                document.id,
                document.confluence_page_id,
                document.qa_passed,
                document.model_dump_json(),
            )

    async def get_document(self, document_id: str) -> Document | None:
        pool = await self._ensure_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow("SELECT data FROM documents WHERE id = $1", document_id)
            return Document.model_validate_json(row["data"]) if row else None

    async def count_documents(self) -> int:
        pool = await self._ensure_pool()
        async with pool.acquire() as conn:
            return await conn.fetchval("SELECT COUNT(*) FROM documents")

    async def get_latest_qa_status_for_page(self, confluence_page_id: str) -> bool | None:
        pool = await self._ensure_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT qa_passed FROM documents WHERE confluence_page_id = $1 ORDER BY saved_at DESC LIMIT 1",
                confluence_page_id,
            )
            return bool(row["qa_passed"]) if row else None

    async def save_team(self, team: Team) -> None:
        pool = await self._ensure_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                "INSERT INTO teams (team_code, data) VALUES ($1, $2) "
                "ON CONFLICT (team_code) DO UPDATE SET data = EXCLUDED.data",
                team.team_code,
                team.model_dump_json(),
            )

    async def save_team_if_new(self, team: Team) -> bool:
        pool = await self._ensure_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "INSERT INTO teams (team_code, data) VALUES ($1, $2) "
                "ON CONFLICT (team_code) DO NOTHING RETURNING team_code",
                team.team_code,
                team.model_dump_json(),
            )
            return row is not None

    async def get_team(self, team_code: str) -> Team | None:
        pool = await self._ensure_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow("SELECT data FROM teams WHERE team_code = $1", team_code)
            return Team.model_validate_json(row["data"]) if row else None

    async def save_team_rule(self, rule: TeamRule) -> None:
        pool = await self._ensure_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                "INSERT INTO team_rules (id, team_code, data) VALUES ($1, $2, $3) "
                "ON CONFLICT (id) DO UPDATE SET team_code = EXCLUDED.team_code, data = EXCLUDED.data",
                rule.id,
                rule.team_code,
                rule.model_dump_json(),
            )

    async def get_team_rule(self, rule_id: str) -> TeamRule | None:
        pool = await self._ensure_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow("SELECT data FROM team_rules WHERE id = $1", rule_id)
            return TeamRule.model_validate_json(row["data"]) if row else None

    async def list_team_rules_for_team(self, team_code: str) -> list[TeamRule]:
        pool = await self._ensure_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch("SELECT data FROM team_rules WHERE team_code = $1", team_code)
            return [TeamRule.model_validate_json(row["data"]) for row in rows]

    async def delete_team_rule(self, rule_id: str) -> bool:
        pool = await self._ensure_pool()
        async with pool.acquire() as conn:
            row = await conn.fetchrow("DELETE FROM team_rules WHERE id = $1 RETURNING id", rule_id)
            return row is not None


class Store:
    def __init__(self, dsn: str | None = None) -> None:
        self._lock = asyncio.Lock()
        self._qa_jobs: dict[str, QAJob] = {}
        self._issues: dict[str, Issue] = {}
        self._backend: _SqliteBackend | _PostgresBackend = _PostgresBackend(dsn) if dsn else _SqliteBackend()

    async def save_document(self, document: Document) -> None:
        async with self._lock:
            await self._backend.save_document(document)

    async def get_document(self, document_id: str) -> Document | None:
        async with self._lock:
            return await self._backend.get_document(document_id)

    async def count_documents(self) -> int:
        async with self._lock:
            return await self._backend.count_documents()

    async def get_latest_qa_status_for_page(self, confluence_page_id: str) -> bool | None:
        async with self._lock:
            return await self._backend.get_latest_qa_status_for_page(confluence_page_id)

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

    async def save_team(self, team: Team) -> None:
        async with self._lock:
            await self._backend.save_team(team)

    async def save_team_if_new(self, team: Team) -> bool:
        # Uniqueness is enforced by the backend's own primary-key constraint (sqlite
        # IntegrityError / Postgres ON CONFLICT DO NOTHING) — combined with self._lock, this
        # closes the same TOCTOU window a separate get_team()+save_team() pair would leave open
        # for two concurrent creates racing on the same generated code.
        async with self._lock:
            return await self._backend.save_team_if_new(team)

    async def get_team(self, team_code: str) -> Team | None:
        async with self._lock:
            return await self._backend.get_team(team_code)

    async def save_team_rule(self, rule: TeamRule) -> None:
        async with self._lock:
            await self._backend.save_team_rule(rule)

    async def get_team_rule(self, rule_id: str) -> TeamRule | None:
        async with self._lock:
            return await self._backend.get_team_rule(rule_id)

    async def list_team_rules_for_team(self, team_code: str) -> list[TeamRule]:
        async with self._lock:
            return await self._backend.list_team_rules_for_team(team_code)

    async def delete_team_rule(self, rule_id: str) -> bool:
        async with self._lock:
            return await self._backend.delete_team_rule(rule_id)


store = Store(dsn=settings.database_url or None)
