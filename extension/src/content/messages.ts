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

// content script → 사이드패널: 문서 위 하이라이트(또는 그 AI 제안 말풍선)를 클릭했을 때, 실제 편집은
// 오른쪽 패널에서 하도록 그 이슈로 포커스를 옮기라고 알리는 푸시. 요청/응답이 아니라
// chrome.runtime.sendMessage로 발사(fire-and-forget)한다.
export interface IssueOverlayFocusMessage {
  type: 'ISSUE_OVERLAY_FOCUS'
  issueId: string
}

// 사이드패널 → content script: 오른쪽 패널에서 "수정 저장"을 눌렀을 때 실제 컨플루언스 반영을 요청한다.
// 컨텐츠 스크립트가 페이지와 동일 출처라 세션 쿠키로 컨플루언스 REST API를 호출할 수 있어서, 실제
// fetch는 여기서 수행하고 결과만 응답으로 돌려준다.
export interface ApplyIssueEditRequest {
  type: 'APPLY_ISSUE_EDIT'
  issueId: string
  oldText: string
  newText: string
}

export type ApplyIssueEditResponse = { ok: true } | { ok: false; error: string }

// 사이드패널 → content script: 오른쪽 패널에서 보고 있는 이슈가 바뀔 때마다(이전/다음, Overview 카드
// 클릭 등) 문서 본문의 해당 하이라이트가 보이는 위치로 자동 스크롤해달라는 요청.
export interface ScrollToIssueRequest {
  type: 'SCROLL_TO_ISSUE'
  issueId: string
}

export interface ScrollToIssueResponse {
  ok: boolean
}
