import { htmlToChapterMarkdown } from './confluenceParser'
import { hideLoadingOverlay, showLoadingOverlay } from './loadingOverlay'
import type {
  ExtractConfluenceContentRequest,
  ExtractConfluenceContentResponse,
  FetchPageMarkdownRequest,
  FetchPageMarkdownResponse,
  ListSiblingPagesRequest,
  ListSiblingPagesResponse,
  NavigateToEditModeRequest,
  NavigateToEditModeResponse,
  OpenReferenceDocumentRequest,
  OpenReferenceDocumentResponse,
} from './messages'

export function extractPageId(url: string): string | null {
  // "/pages/" 바로 뒤에 숫자가 오는 형태(보기 모드) 외에, 새 편집기의 초안 URL은
  // "/pages/edit-v2/{id}"처럼 모드 이름이 한 단계 더 끼어든다(실사용자가 이 URL에서 겪은 실제
  // 버그) — 영숫자/하이픈으로 된 모드 세그먼트 하나는 건너뛰도록 느슨화한다("v2"처럼 숫자가 섞인
  // 모드명도 있어 [a-z-]+로는 부족함). "/pages/{id}/title"처럼 모드 세그먼트가 아예 없는 경우엔
  // 정규식 백트래킹이 이 선택적 그룹을 건너뛰고 바로 (\d+)로 매칭한다.
  const pathMatch = url.match(/\/pages\/(?:[\w-]+\/)?(\d+)/)
  if (pathMatch) return pathMatch[1]

  const queryMatch = url.match(/[?&]pageId=(\d+)/)
  if (queryMatch) return queryMatch[1]

  return null
}

interface ConfluenceContentResponse {
  title: string
  body: { storage: { value: string } }
}

interface ConfluenceAncestorsResponse {
  ancestors: { id: string; title: string }[]
}

interface ConfluenceChildPagesResponse {
  results: { id: string; title: string }[]
}

export function parseParentInfo(data: ConfluenceAncestorsResponse): { id: string; title: string } | null {
  if (!data.ancestors.length) return null
  return data.ancestors[data.ancestors.length - 1]
}

export function parseSiblingPages(
  data: ConfluenceChildPagesResponse,
  excludePageId: string,
): { id: string; title: string }[] {
  return data.results.filter((page) => page.id !== excludePageId).map((page) => ({ id: page.id, title: page.title }))
}

async function fetchPageMarkdown(
  pageId: string,
  options?: { preserveHeadingLevels?: boolean },
): Promise<{ title: string; markdown: string } | null> {
  const res = await fetch(`${location.origin}/wiki/rest/api/content/${pageId}?expand=body.storage`, {
    credentials: 'include',
  })
  if (!res.ok) return null

  const data = (await res.json()) as ConfluenceContentResponse
  return { title: data.title, markdown: htmlToChapterMarkdown(data.title, data.body.storage.value, options) }
}

async function extractCurrentPage(): Promise<ExtractConfluenceContentResponse> {
  const pageId = extractPageId(location.href)
  if (!pageId) return { ok: false, error: 'NOT_A_CONFLUENCE_PAGE' }

  showLoadingOverlay()
  try {
    const page = await fetchPageMarkdown(pageId)
    if (!page) return { ok: false, error: 'FETCH_FAILED' }
    return { ok: true, markdown: page.markdown, title: page.title, pageId }
  } catch (err) {
    return { ok: false, error: 'FETCH_FAILED', detail: String(err) }
  } finally {
    hideLoadingOverlay()
  }
}

async function listSiblingPages(): Promise<ListSiblingPagesResponse> {
  const pageId = extractPageId(location.href)
  if (!pageId) return { ok: false, error: 'NOT_A_CONFLUENCE_PAGE' }

  try {
    const ancestorsRes = await fetch(`${location.origin}/wiki/rest/api/content/${pageId}?expand=ancestors`, {
      credentials: 'include',
    })
    if (!ancestorsRes.ok) return { ok: false, error: 'FETCH_FAILED', detail: `${ancestorsRes.status}` }

    const parent = parseParentInfo((await ancestorsRes.json()) as ConfluenceAncestorsResponse)
    if (!parent) return { ok: false, error: 'NO_PARENT' }

    const childrenRes = await fetch(`${location.origin}/wiki/rest/api/content/${parent.id}/child/page?limit=100`, {
      credentials: 'include',
    })
    if (!childrenRes.ok) return { ok: false, error: 'FETCH_FAILED', detail: `${childrenRes.status}` }

    const siblings = parseSiblingPages((await childrenRes.json()) as ConfluenceChildPagesResponse, pageId)
    return { ok: true, siblings, parentTitle: parent.title }
  } catch (err) {
    return { ok: false, error: 'FETCH_FAILED', detail: String(err) }
  }
}

async function handleFetchPageMarkdown(pageId: string, preserveHeadingLevels?: boolean): Promise<FetchPageMarkdownResponse> {
  try {
    const page = await fetchPageMarkdown(pageId, { preserveHeadingLevels })
    if (!page) return { ok: false, error: 'FETCH_FAILED' }
    return { ok: true, markdown: page.markdown, title: page.title }
  } catch (err) {
    return { ok: false, error: 'FETCH_FAILED', detail: String(err) }
  }
}

// 새 편집기 URL은 "/wiki/pages/edit-v2/{id}"가 아니라 "/wiki/spaces/{스페이스키}/pages/edit-v2/{id}"
// 다(스페이스 키가 없으면 404 — 실사용 확인됨). extractPageId는 pageId만 뽑고 스페이스 키는
// 모르니, 이동 전에 그 페이지의 스페이스 키를 REST로 한 번 조회해야 한다.
export async function navigateToEditMode(): Promise<NavigateToEditModeResponse> {
  const pageId = extractPageId(location.href)
  if (!pageId) return { ok: false, error: 'NOT_A_CONFLUENCE_PAGE' }
  try {
    const res = await fetch(`${location.origin}/wiki/rest/api/content/${pageId}?expand=space`, {
      credentials: 'include',
    })
    if (!res.ok) return { ok: false, error: 'FETCH_FAILED', detail: `${res.status}` }
    const data = (await res.json()) as { space?: { key: string } }
    if (!data.space?.key) return { ok: false, error: 'FETCH_FAILED', detail: 'no space key' }
    location.href = `${location.origin}/wiki/spaces/${data.space.key}/pages/edit-v2/${pageId}`
    return { ok: true }
  } catch (err) {
    return { ok: false, error: 'FETCH_FAILED', detail: String(err) }
  }
}

// 참고문서는 지금 문서와 다른 페이지라 이 탭 안에서 스크롤해 찾을 방법이 없다 — 새 탭으로 연다.
// 스페이스 키/제목 경로 없이 페이지 id만으로 열리는 레거시 URL이라 항상 유효하다.
function openReferenceDocument(pageId: string): OpenReferenceDocumentResponse {
  window.open(`${location.origin}/wiki/pages/viewpage.action?pageId=${pageId}`, '_blank', 'noopener')
  return { ok: true }
}

type ContentScriptRequest =
  | ExtractConfluenceContentRequest
  | ListSiblingPagesRequest
  | FetchPageMarkdownRequest
  | NavigateToEditModeRequest
  | OpenReferenceDocumentRequest
type ContentScriptResponse =
  | ExtractConfluenceContentResponse
  | ListSiblingPagesResponse
  | FetchPageMarkdownResponse
  | NavigateToEditModeResponse
  | OpenReferenceDocumentResponse

chrome.runtime.onMessage.addListener(
  (message: ContentScriptRequest, _sender, sendResponse: (response: ContentScriptResponse) => void) => {
    if (message.type === 'EXTRACT_CONFLUENCE_CONTENT') {
      void extractCurrentPage().then(sendResponse)
      return true
    }
    if (message.type === 'LIST_SIBLING_PAGES') {
      void listSiblingPages().then(sendResponse)
      return true
    }
    if (message.type === 'FETCH_PAGE_MARKDOWN') {
      void handleFetchPageMarkdown(message.pageId, message.preserveHeadingLevels).then(sendResponse)
      return true
    }
    if (message.type === 'NAVIGATE_TO_EDIT_MODE') {
      void navigateToEditMode().then(sendResponse)
      return true
    }
    if (message.type === 'OPEN_REFERENCE_DOCUMENT') {
      sendResponse(openReferenceDocument(message.pageId))
      return true
    }
    return undefined
  },
)
