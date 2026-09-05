export interface ExtractConfluenceContentRequest {
  type: 'EXTRACT_CONFLUENCE_CONTENT'
}

export type ExtractConfluenceContentResponse =
  | { ok: true; markdown: string; title: string; pageId: string }
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

// 문단 하나(현재/연관/완료 위치)를 가리키는 데 필요한 최소 정보 — content script는 이 텍스트를
// buildLooseTextRegex로 찾아 그 텍스트를 담은 블록 엘리먼트(p/li/td/heading 등)를 앵커로 삼는다.
export interface SuggestionLocation {
  text: string
  // "정보 누락(MI)"처럼 애초에 원문에 없는 걸 지적하는 위치는 text로 찾을 대상 자체가 없다 — 그럴
  // 땐 이 위치가 속한 위계(예: "6. 프로덕트 기능 > 6-1. 메인 배너")의 제목으로라도 찾아가 폴백한다.
  location: string
}

// current 위치만 문서에서 직접 편집 가능하다(related/done은 읽기 전용) — 저장 전 검증(원래 문제
// 문구가 남아있는지 + AI 유사도 체크)에 필요한 필드까지 함께 싣는다. suggestion이 null이면
// (관계형 이슈의 두 번째 위치를 편집 중) AI 유사도 체크를 건너뛴다 — 비교 기준이 될 "AI 제안"
// 자체가 없기 때문(패널의 기존 편집 로직과 동일한 규칙).
export interface EditableSuggestionLocation extends SuggestionLocation {
  criteria: string
  reason: string
  suggestion: string | null
}

// 사이드패널 → content script: 지금 작업 중인 제안 하나를 통째로 알려준다. 문서에는 이 제안과
// 관련된 위치만 틴트+마커로 표시하고, 나머지 문단은 전부 흐리게(dim) 처리한다 — 이전의 "모든 이슈를
// 항상 다 하이라이트" 방식은 새 디자인(3b/3c)에서 폐기됐다.
export interface SetActiveSuggestionRequest {
  type: 'SET_ACTIVE_SUGGESTION'
  current: EditableSuggestionLocation
  related: SuggestionLocation | null
  doneLocations: SuggestionLocation[]
}

export interface SetActiveSuggestionResponse {
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

// 사이드패널 → content script: "QA 완료" 직전에 좌측 문서 뷰(라이브 DOM)의 h2~h6 헤딩 상태를
// 저장본(복제본 또는 원본)과 대조해, 사용자가 제안 저장 없이 직접 고친 헤딩 번호를 복제본에
// 반영해달라는 요청 — 이래야 이어지는 넘버링 검증이 옛 저장본이 아니라 지금 화면 상태를 본다.
// reconciled는 실제로 복제본에 반영한 헤딩 수, skippedCountMismatch는 헤딩 개수가 달라 위치
// 기반 대조를 건너뛴 경우(삽입/삭제 — 이번 범위 밖).
export interface CommitDocumentEditsRequest {
  type: 'COMMIT_DOCUMENT_EDITS'
}

export type CommitDocumentEditsResponse =
  | { ok: true; reconciled: number; skippedCountMismatch?: boolean }
  | { ok: false; error: string }

// 사이드패널 → content script: 넘버링 확인 화면(NumberingCheckScreen)에서 체크한 항목들을 하나씩
// 적용해달라는 요청 — 일반 AI 제안 편집(handleSaveClick)과 달리 패널이 직접 트리거해야 한다(그
// 이슈들은 문서에서 클릭해 들어갈 수 있는 하이라이트가 애초에 없으므로).
export interface ApplyIssueEditRequest {
  type: 'APPLY_ISSUE_EDIT'
  issueId: string
  oldText: string
  newText: string
}

export type ApplyIssueEditResponse = { ok: true } | { ok: false; error: string }

export interface ClearActiveSuggestionRequest {
  type: 'CLEAR_ACTIVE_SUGGESTION'
}

export interface ClearActiveSuggestionResponse {
  ok: true
}

// 사이드패널 → content script: 지속적인 틴트/마커 없이 그냥 그 위치로 스크롤만 해달라는 요청 —
// 넘버링 하모나이징 화면(NumberingCheckScreen)처럼 활성 제안 개념이 없는 화면에서 쓴다.
export interface ScrollToLocationRequest {
  type: 'SCROLL_TO_LOCATION'
  location: SuggestionLocation
}

export interface ScrollToLocationResponse {
  ok: boolean
}

// 사이드패널 → content script: 3d(완료 요약)에서 문서 제목 옆에 "✓ QA 통과" 배지를 붙이거나 뗀다.
export interface ShowQaPassedBadgeRequest {
  type: 'SHOW_QA_PASSED_BADGE'
}

export interface ClearQaPassedBadgeRequest {
  type: 'CLEAR_QA_PASSED_BADGE'
}

export interface QaPassedBadgeResponse {
  ok: boolean
}

// 사이드패널 → content script: "QA 시작"을 누르면 지금 보고 있는 문서를 컨플루언스 자체
// 편집 모드로 넘긴다 — 사용자가 이슈를 보면서 그 자리에서 직접 고칠 수 있게. pageId는 여기서
// 다시 안 받고 content script가 자기 location에서 뽑는다(사이드패널은 이 탭의 origin을 모름).
export interface NavigateToEditModeRequest {
  type: 'NAVIGATE_TO_EDIT_MODE'
}

export type NavigateToEditModeResponse =
  | { ok: true }
  | { ok: false; error: 'NOT_A_CONFLUENCE_PAGE' | 'FETCH_FAILED'; detail?: string }

// 사이드패널 → content script: 타문서 정합성(XDC) 이슈의 참고문서를 새 탭으로 연다 — 컨플루언스
// 페이지 id만 있으면 스페이스/제목 경로 없이도 열리는 레거시 URL(viewpage.action?pageId=)을
// 쓴다. 참고문서는 현재 문서와 다른 페이지라 지금 문서의 DOM 안에서 스크롤해 찾을 방법이 없다.
export interface OpenReferenceDocumentRequest {
  type: 'OPEN_REFERENCE_DOCUMENT'
  pageId: string
}

export interface OpenReferenceDocumentResponse {
  ok: boolean
}

// content script → 사이드패널: 문서에서 직접 편집(current 문단의 인라인 저장)이 성공했음을
// 알리는 푸시. 요청/응답이 아니라 chrome.runtime.sendMessage로 발사(fire-and-forget)한다 —
// content script는 issueId를 모르므로(SuggestionLocation은 텍스트/위치만 담음), 패널이 이미
// 알고 있는 activeIssueId/activeLocationIndex로 STAGE_ISSUE_EDIT + 다음 제안 이동을 처리한다.
export interface SuggestionEditSavedMessage {
  type: 'SUGGESTION_EDIT_SAVED'
  newText: string
}
