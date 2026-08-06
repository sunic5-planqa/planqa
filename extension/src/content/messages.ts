export interface ExtractConfluenceContentRequest {
  type: 'EXTRACT_CONFLUENCE_CONTENT'
}

export type ExtractConfluenceContentResponse =
  | { ok: true; markdown: string; title: string }
  | { ok: false; error: 'NOT_A_CONFLUENCE_PAGE' | 'FETCH_FAILED'; detail?: string }

export interface ListSiblingPagesRequest {
  type: 'LIST_SIBLING_PAGES'
}

export type ListSiblingPagesResponse =
  | { ok: true; siblings: { id: string; title: string }[]; parentTitle: string }
  | { ok: false; error: 'NOT_A_CONFLUENCE_PAGE' | 'NO_PARENT' | 'FETCH_FAILED'; detail?: string }

export interface FetchPageMarkdownRequest {
  type: 'FETCH_PAGE_MARKDOWN'
  pageId: string
}

export type FetchPageMarkdownResponse =
  | { ok: true; markdown: string; title: string }
  | { ok: false; error: 'FETCH_FAILED'; detail?: string }

// 문서 본문 위에 직접 하이라이트/AI 제안 툴팁을 얹는 인라인 수정 오버레이용 메시지.
// OverlayIssue는 IssueResponse의 부분집합 — content script는 백엔드 타입을 몰라도 되게 별도로 둔다.
export interface OverlayIssue {
  id: string
  input_text: string
  criteria: string
  reason: string
  suggestion: string
}

export interface ShowIssueOverlayRequest {
  type: 'SHOW_ISSUE_OVERLAY'
  issues: OverlayIssue[]
}

export interface ShowIssueOverlayResponse {
  ok: true
  matched: number
  total: number
}

export interface ClearIssueOverlayRequest {
  type: 'CLEAR_ISSUE_OVERLAY'
}

export interface ClearIssueOverlayResponse {
  ok: true
}

// content script → 사이드패널: 문서 위에서 직접 "오류 수정하기"를 눌렀을 때 로컬 상태를 동기화하기 위한 푸시.
// 요청/응답이 아니라 chrome.runtime.sendMessage로 발사(fire-and-forget)한다.
export interface IssueOverlayResolvedMessage {
  type: 'ISSUE_OVERLAY_RESOLVED'
  issueId: string
  editedText: string
}
