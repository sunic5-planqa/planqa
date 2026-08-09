import { ApiError, NotImplementedError } from './errors'
import type {
  CreateDocumentResponse,
  CreateQAJobResponse,
  DocumentCountResponse,
  ExportDocumentResponse,
  IssueResponse,
  QAJobStatusResponse,
  SimilarityCheckResponse,
  UpdateIssueRequest,
  UpdateIssueResponse,
} from './types'

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText)
    if (res.status === 501) throw new NotImplementedError(detail)
    throw new ApiError(res.status, detail)
  }

  return res.json() as Promise<T>
}

export const api = {
  createDocument: (rawText: string) =>
    request<CreateDocumentResponse>('/documents', {
      method: 'POST',
      body: JSON.stringify({ raw_text: rawText }),
    }),

  createQAJob: (documentId: string) =>
    request<CreateQAJobResponse>(`/documents/${documentId}/qa-jobs`, { method: 'POST' }),

  getQAJobStatus: (jobId: string) => request<QAJobStatusResponse>(`/qa-jobs/${jobId}/status`),

  listQAJobIssues: (jobId: string) => request<IssueResponse[]>(`/qa-jobs/${jobId}/issues`),

  updateIssue: (issueId: string, body: UpdateIssueRequest) =>
    request<UpdateIssueResponse>(`/issues/${issueId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  exportDocument: (documentId: string) => request<ExportDocumentResponse>(`/documents/${documentId}/export`),

  checkEditSimilarity: (suggestion: string, editedText: string) =>
    request<SimilarityCheckResponse>('/issues/similarity-check', {
      method: 'POST',
      body: JSON.stringify({ suggestion, edited_text: editedText }),
    }),

  getDocumentCount: () => request<DocumentCountResponse>('/documents/count'),
}
