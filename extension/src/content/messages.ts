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
  // 넘버링 검증 재조회 전용 — true면 컨플루언스 h1~h6 레벨을 그대로 보존해서 추출한다(기본값은
  // AI QA 리뷰용 추출과 동일하게 h1을 h2와 같은 레벨로 뭉갠다). confluenceParser.ts의
  // HtmlToChapterMarkdownOptions.preserveHeadingLevels 참고.
  preserveHeadingLevels?: boolean
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
  // "정보 누락(MI)"처럼 애초에 원문에 없는 걸 지적하는 이슈는 input_text로 문서 안에서 찾을 대상 자체가
  // 없다 — 그럴 때 이 이슈가 속한 위계(예: "6. 프로덕트 기능 > 6-1. 메인 배너")의 제목으로라도 찾아가
  // 하이라이트할 수 있도록 폴백 근거로 쓴다.
  location: string
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

// 사이드패널 → content script: QA 리뷰 중 실제 수정이 저장되고 있는 "복제본" 페이지의 id를 물어본다.
// 아직 한 건도 적용한 적이 없으면(복제본이 아직 안 만들어졌으면) pageId는 null. originalPageId는
// 지금 탭이 보고 있는 원본 페이지 id — 넘버링 재검증이 (복제본이 없을 때) 어느 페이지의 최신
// 마크다운을 다시 가져와야 하는지 알아야 해서 같이 내려준다(둘 다 컨플루언스 페이지가 아니면 null).
export interface GetActiveDuplicatePageRequest {
  type: 'GET_ACTIVE_DUPLICATE_PAGE'
}

export type GetActiveDuplicatePageResponse = { ok: true; pageId: string | null; originalPageId: string | null }
