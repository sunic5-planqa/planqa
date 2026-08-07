import type {
  ApplyIssueEditRequest,
  ApplyIssueEditResponse,
  ClearIssueOverlayRequest,
  ClearIssueOverlayResponse,
  IssueOverlayFocusMessage,
  OverlayIssue,
  ShowIssueOverlayRequest,
  ShowIssueOverlayResponse,
} from './messages'

// 문서 본문 위에 모든 이슈를 한 번에 하이라이트 박스로 표시하고, 클릭하면 통일된 "AI 제안" 말풍선(읽기
// 전용)을 보여준다. 실제 수정/저장은 여기서 하지 않고 사이드패널(오른쪽 패널)에서 하도록 포커스만
// 넘긴다 — Figma SCREEN 04: 본문 위 말풍선은 안내만, 편집은 오른쪽 "수정 진행 중..." 카드에서.
// 컨플루언스에 실제로 쓰는 fetch만 이 컨텐츠 스크립트가 대신 수행한다(세션 쿠키가 페이지와 동일 출처
// 여야 붙어서 나가므로) — 사이드패널이 APPLY_ISSUE_EDIT 요청을 보내면 여기서 처리해 응답한다.
const HIGHLIGHT_CLASS = 'sunnic-issue-highlight'
const RESOLVED_CLASS = 'sunnic-issue-resolved'
const TOOLTIP_CLASS = 'sunnic-issue-tooltip'
const STYLE_ID = 'sunnic-issue-overlay-style'

const STYLE = `
.${HIGHLIGHT_CLASS} {
  background: rgba(124, 92, 255, 0.14);
  outline: 2px solid #7c5cff;
  outline-offset: 1px;
  border-radius: 3px;
  cursor: pointer;
}
.${HIGHLIGHT_CLASS}.${RESOLVED_CLASS} {
  background: rgba(46, 160, 67, 0.12);
  outline-color: #2ea043;
}
.${TOOLTIP_CLASS} {
  position: absolute;
  z-index: 2147483647;
  max-width: 280px;
  background: #fff;
  color: #172b4d;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(9, 30, 66, 0.25);
  padding: 10px 12px;
  font-family: -apple-system, "Apple SD Gothic Neo", sans-serif;
  font-size: 12.5px;
  line-height: 1.5;
}
.${TOOLTIP_CLASS} .sunnic-tooltip-heading {
  font-weight: 700;
  color: #7c5cff;
  margin-bottom: 2px;
}
`

function ensureStyleInjected(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = STYLE
  document.head.appendChild(style)
}

function isInsideOverlayNode(node: Node): boolean {
  const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element)
  return !!element?.closest(`.${HIGHLIGHT_CLASS}, .${TOOLTIP_CLASS}`)
}

// TreeWalker로 본문 텍스트 노드를 훑어 issue.input_text와 정확히 일치하는 첫 구간을 찾는다.
// 백엔드 파서 오프셋(마크다운 기준)이 아니라 실제 렌더링된 DOM 텍스트를 직접 검색 — 오버레이는
// 사용자가 보는 화면 위에 그려야 하므로 라이브 DOM 기준이 맞다.
function findMatch(input: string): { node: Text; offset: number } | null {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      if (isInsideOverlayNode(node)) return NodeFilter.FILTER_REJECT
      const parentTag = node.parentElement?.tagName
      if (parentTag === 'SCRIPT' || parentTag === 'STYLE') return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })

  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    const offset = current.textContent?.indexOf(input) ?? -1
    if (offset !== -1) return { node: current as Text, offset }
  }
  return null
}

const marksByIssueId = new Map<string, HTMLElement>()

function wrapIssue(issue: OverlayIssue): boolean {
  const match = findMatch(issue.input_text)
  if (!match) return false

  const range = document.createRange()
  range.setStart(match.node, match.offset)
  range.setEnd(match.node, match.offset + issue.input_text.length)

  const mark = document.createElement('mark')
  mark.className = HIGHLIGHT_CLASS
  mark.dataset.sunnicIssueId = issue.id
  range.surroundContents(mark)
  mark.addEventListener('click', (event) => {
    event.stopPropagation()
    toggleTooltip(mark, issue)
    chrome.runtime.sendMessage<IssueOverlayFocusMessage>({ type: 'ISSUE_OVERLAY_FOCUS', issueId: issue.id }).catch(() => {
      // 사이드패널이 닫혀있으면 받는 쪽이 없어도 말풍선 표시 자체는 유효하니 무시한다.
    })
  })
  marksByIssueId.set(issue.id, mark)
  return true
}

let activeTooltip: HTMLElement | null = null

function closeTooltip(): void {
  activeTooltip?.remove()
  activeTooltip = null
}

function positionNear(el: HTMLElement, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect()
  el.style.top = `${window.scrollY + rect.bottom + 6}px`
  el.style.left = `${window.scrollX + rect.left}px`
}

// 통일된 읽기 전용 "AI 제안" 말풍선 — 어떤 이슈든 항상 같은 모양(제목 + 제안 한 줄)이고 버튼이 없다.
// 실제 수정은 오른쪽 패널에서 하므로 여기서는 안내만 한다.
function toggleTooltip(mark: HTMLElement, issue: OverlayIssue): void {
  if (activeTooltip?.dataset.sunnicForIssue === issue.id) {
    closeTooltip()
    return
  }
  closeTooltip()

  const tooltip = document.createElement('div')
  tooltip.className = TOOLTIP_CLASS
  tooltip.dataset.sunnicForIssue = issue.id
  tooltip.innerHTML = `
    <div class="sunnic-tooltip-heading">AI 제안</div>
    <div>${issue.suggestion}</div>
  `
  positionNear(tooltip, mark)
  document.body.appendChild(tooltip)
  activeTooltip = tooltip
}

export function applyIssueOverlay(issues: OverlayIssue[]): { matched: number; total: number } {
  ensureStyleInjected()
  clearIssueOverlay()
  const matched = issues.filter(wrapIssue).length
  return { matched, total: issues.length }
}

export function clearIssueOverlay(): void {
  closeTooltip()
  marksByIssueId.clear()
  for (const mark of Array.from(document.querySelectorAll(`.${HIGHLIGHT_CLASS}`))) {
    const parent = mark.parentNode
    if (!parent) continue
    parent.replaceChild(document.createTextNode(mark.textContent ?? ''), mark)
    parent.normalize()
  }
}

document.addEventListener('click', (event) => {
  const target = event.target as Element | null
  if (activeTooltip && !target?.closest(`.${TOOLTIP_CLASS}, .${HIGHLIGHT_CLASS}`)) {
    closeTooltip()
  }
})

// 컨플루언스 URL(/pages/{id}/... 또는 ?pageId=)에서 페이지 id를 뽑는다.
// confluence-extractor.ts와 동일 로직 — content script 진입점끼리 import로 얽히면 각자 번들에
// onMessage 리스너가 중복 등록될 위험이 있어 이 작은 순수함수만 그대로 복제해서 둔다.
function extractPageId(url: string): string | null {
  const pathMatch = url.match(/\/pages\/(\d+)/)
  if (pathMatch) return pathMatch[1]
  const queryMatch = url.match(/[?&]pageId=(\d+)/)
  return queryMatch ? queryMatch[1] : null
}

type ApplyResult = { ok: true } | { ok: false; error: string }

// pageId가 가리키는 페이지의 body.storage에서 oldText → newText로 문자열 치환한 뒤 PUT으로 저장한다.
// 표/목록처럼 렌더링 시 텍스트가 변형되는 구간은 storage HTML에 그대로 없을 수 있어 실패 처리하고,
// 문서를 깨뜨리느니 아무것도 안 하는 쪽을 택한다.
async function replaceTextAndSave(pageId: string, oldText: string, newText: string): Promise<ApplyResult> {
  const getRes = await fetch(`${location.origin}/wiki/rest/api/content/${pageId}?expand=body.storage,version`, {
    credentials: 'include',
  })
  if (!getRes.ok) return { ok: false, error: `문서를 불러오지 못했습니다 (${getRes.status})` }

  const data = (await getRes.json()) as {
    title: string
    version: { number: number }
    body: { storage: { value: string } }
  }
  const html = data.body.storage.value
  if (!html.includes(oldText)) return { ok: false, error: '원문에서 해당 문구를 찾지 못했습니다.' }

  const putRes = await fetch(`${location.origin}/wiki/rest/api/content/${pageId}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Atlassian-Token': 'no-check' },
    body: JSON.stringify({
      version: { number: data.version.number + 1 },
      title: data.title,
      type: 'page',
      body: { storage: { value: html.replace(oldText, newText), representation: 'storage' } },
    }),
  })
  if (!putRes.ok) return { ok: false, error: `저장에 실패했습니다 (${putRes.status})` }
  return { ok: true }
}

// QA 리뷰 세션당 복제본 1개 — 원본은 절대 쓰지 않고, 첫 적용에서 이 복제본을 만들어 이후 모든 적용을
// 여기에 누적한다. 페이지를 새로고침하면 초기화되고 다음 적용에서 새 복제본이 다시 만들어진다.
let duplicateSession: { pageId: string; title: string } | null = null

// 테스트 전용 — 모듈이 파일 내 여러 테스트에 걸쳐 싱글턴으로 유지되므로, 세션이 없는 상태(첫 적용)를
// 매 테스트마다 재현하려면 이걸로 초기화해야 한다.
export function __resetDuplicateSessionForTests(): void {
  duplicateSession = null
}

async function ensureDuplicateSession(originalPageId: string): Promise<{ ok: true; pageId: string } | { ok: false; error: string }> {
  if (duplicateSession) return { ok: true, pageId: duplicateSession.pageId }

  const originalRes = await fetch(`${location.origin}/wiki/rest/api/content/${originalPageId}?expand=body.storage,space`, {
    credentials: 'include',
  })
  if (!originalRes.ok) return { ok: false, error: `원본을 불러오지 못했습니다 (${originalRes.status})` }

  const original = (await originalRes.json()) as {
    title: string
    space?: { key: string }
    body: { storage: { value: string } }
  }
  if (!original.space?.key) return { ok: false, error: '스페이스 정보를 확인하지 못했습니다.' }

  const title = `${original.title} (QA 검토 수정본 ${new Date().toLocaleString('ko-KR')})`
  const createRes = await fetch(`${location.origin}/wiki/rest/api/content`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Atlassian-Token': 'no-check' },
    body: JSON.stringify({
      type: 'page',
      title,
      space: { key: original.space.key },
      ancestors: [{ id: originalPageId }],
      body: { storage: { value: original.body.storage.value, representation: 'storage' } },
    }),
  })
  if (!createRes.ok) return { ok: false, error: `복제본 생성에 실패했습니다 (${createRes.status})` }

  const created = (await createRes.json()) as { id: string }
  duplicateSession = { pageId: created.id, title }
  return { ok: true, pageId: created.id }
}

export async function applyIssueEdit(issueId: string, oldText: string, newText: string): Promise<ApplyIssueEditResponse> {
  const originalPageId = extractPageId(location.href)
  if (!originalPageId) return { ok: false, error: '컨플루언스 문서 URL이 아니라 복제본을 만들 수 없습니다.' }

  const session = await ensureDuplicateSession(originalPageId)
  if (!session.ok) return session

  const result = await replaceTextAndSave(session.pageId, oldText, newText)
  if (!result.ok) return result

  marksByIssueId.get(issueId)?.classList.add(RESOLVED_CLASS)
  closeTooltip()
  return { ok: true }
}

type OverlayRequest = ShowIssueOverlayRequest | ClearIssueOverlayRequest | ApplyIssueEditRequest
type OverlayResponse = ShowIssueOverlayResponse | ClearIssueOverlayResponse | ApplyIssueEditResponse

chrome.runtime.onMessage.addListener(
  (message: OverlayRequest, _sender, sendResponse: (response: OverlayResponse) => void) => {
    if (message.type === 'SHOW_ISSUE_OVERLAY') {
      sendResponse({ ok: true, ...applyIssueOverlay(message.issues) })
      return true
    }
    if (message.type === 'CLEAR_ISSUE_OVERLAY') {
      clearIssueOverlay()
      sendResponse({ ok: true })
      return true
    }
    if (message.type === 'APPLY_ISSUE_EDIT') {
      void applyIssueEdit(message.issueId, message.oldText, message.newText).then(sendResponse)
      return true
    }
    return undefined
  },
)
