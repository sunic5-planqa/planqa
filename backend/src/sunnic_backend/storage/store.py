import asyncio

from sunnic_backend.models.document import Document
from sunnic_backend.models.issue import Issue
from sunnic_backend.models.qa_job import QAJob


class Store:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._documents: dict[str, Document] = {}
        self._qa_jobs: dict[str, QAJob] = {}
        self._issues: dict[str, Issue] = {}

    async def save_document(self, document: Document) -> None:
        async with self._lock:
            self._documents[document.id] = document

    async def get_document(self, document_id: str) -> Document | None:
        async with self._lock:
            return self._documents.get(document_id)

    async def count_documents(self) -> int:
        async with self._lock:
            return len(self._documents)

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
