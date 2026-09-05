import { ApiError, NotImplementedError } from './errors'
import type {
  AppliedNumberingFix,
  CreateDocumentResponse,
  CreateQAJobRequest,
  CreateQAJobResponse,
  CreateTeamRequest,
  DocumentCountResponse,
  ExportDocumentResponse,
  IssueResponse,
  NumberingIssueResponse,
  QAJobStatusResponse,
  QaStatusResponse,
  SimilarityCheckResponse,
  TeamResponse,
  TeamRuleInput,
  TeamRuleResponse,
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

  createQAJob: (documentId: string, teamCode?: string | null) => {
    const body: CreateQAJobRequest = { team_code: teamCode ?? null }
    return request<CreateQAJobResponse>(`/documents/${documentId}/qa-jobs`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
  },

  getQAJobStatus: (jobId: string) => request<QAJobStatusResponse>(`/qa-jobs/${jobId}/status`),

  listQAJobIssues: (jobId: string) => request<IssueResponse[]>(`/qa-jobs/${jobId}/issues`),

  getNumberingIssues: (jobId: string, rawText: string) =>
    request<NumberingIssueResponse[]>(`/qa-jobs/${jobId}/numbering-issues`, {
      method: 'POST',
      body: JSON.stringify({ raw_text: rawText }),
    }),

  applyNumberingFixes: (jobId: string, applied: AppliedNumberingFix[]) =>
    request<NumberingIssueResponse[]>(`/qa-jobs/${jobId}/numbering-issues/apply`, {
      method: 'POST',
      body: JSON.stringify({ applied }),
    }),

  updateIssue: (issueId: string, body: UpdateIssueRequest) =>
    request<UpdateIssueResponse>(`/issues/${issueId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  exportDocument: (documentId: string) => request<ExportDocumentResponse>(`/documents/${documentId}/export`),

  checkEditSimilarity: (args: {
    originalText: string
    criteria: string
    reason: string
    suggestion: string
    editedText: string
  }) =>
    request<SimilarityCheckResponse>('/issues/similarity-check', {
      method: 'POST',
      body: JSON.stringify({
        original_text: args.originalText,
        criteria: args.criteria,
        reason: args.reason,
        suggestion: args.suggestion,
        edited_text: args.editedText,
      }),
    }),

  getDocumentCount: () => request<DocumentCountResponse>('/documents/count'),

  // confluencePageId를 문서에 붙여 "이 컨플루언스 페이지가 QA 통과했다"를 백엔드에 남긴다 —
  // documentId는 세션마다 새로 생기는 UUID라 재방문 시 조회 키로 못 쓰므로, 조회는 항상
  // getQaStatusByPage(pageId)로 한다.
  updateQaStatus: (documentId: string, confluencePageId: string, passed: boolean) =>
    request<QaStatusResponse>(`/documents/${documentId}/qa-status`, {
      method: 'PATCH',
      body: JSON.stringify({ confluence_page_id: confluencePageId, passed }),
    }),

  getQaStatusByPage: (confluencePageId: string) =>
    request<QaStatusResponse>(`/documents/by-page/${confluencePageId}/qa-status`),

  createTeam: (body: CreateTeamRequest) =>
    request<TeamResponse>('/teams', { method: 'POST', body: JSON.stringify(body) }),

  getTeam: (teamCode: string) => request<TeamResponse>(`/teams/${teamCode}`),

  listTeamRules: (teamCode: string) => request<TeamRuleResponse[]>(`/teams/${teamCode}/rules`),

  createTeamRule: (teamCode: string, body: TeamRuleInput) =>
    request<TeamRuleResponse>(`/teams/${teamCode}/rules`, { method: 'POST', body: JSON.stringify(body) }),

  updateTeamRule: (teamCode: string, ruleId: string, body: TeamRuleInput) =>
    request<TeamRuleResponse>(`/teams/${teamCode}/rules/${ruleId}`, { method: 'PATCH', body: JSON.stringify(body) }),

  setTeamRuleEnabled: (teamCode: string, ruleId: string, enabled: boolean) =>
    request<TeamRuleResponse>(`/teams/${teamCode}/rules/${ruleId}/enabled`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    }),

  deleteTeamRule: (teamCode: string, ruleId: string) =>
    request<{ id: string }>(`/teams/${teamCode}/rules/${ruleId}`, { method: 'DELETE' }),
}
