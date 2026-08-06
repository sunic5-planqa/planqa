import type {
  ClearIssueOverlayRequest,
  ClearIssueOverlayResponse,
  IssueOverlayResolvedMessage,
  OverlayIssue,
  ShowIssueOverlayRequest,
  ShowIssueOverlayResponse,
} from './messages'

// 사이드패널 이슈 목록과 별개로, 문서 본문 위에 직접 하이라이트 박스 + "AI 제안" 툴팁을 그려주고,
// "오류 수정하기"를 누르면 그 자리에서 직접 타이핑해 고칠 수 있는 편집 모드로 들어간 뒤, "적용"을 눌러야
// 컨플루언스 REST API로 실제 원문(body.storage)에 반영한다 — 사이드패널이 아니라 본문에서 바로 고치는
// 흐름. Figma SCREEN 03/04 목업(본문 위 하이라이트 + 제안)에서 한 단계 더 나가, AI 제안을 그대로 적용할
// 수도 있고 편집 모드에서 직접 다듬어 적용할 수도 있게 한다.
const HIGHLIGHT_CLASS = 'sunnic-issue-highlight'
const RESOLVED_CLASS = 'sunnic-issue-resolved'
const EDITING_CLASS = 'sunnic-issue-editing'
const TOOLTIP_CLASS = 'sunnic-issue-tooltip'
const EDIT_CONTROLS_CLASS = 'sunnic-issue-edit-controls'
const STATUS_CLASS = 'sunnic-issue-status'
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
  cursor: default;
}
.${HIGHLIGHT_CLASS}.${EDITING_CLASS} {
  background: #fff;
  outline: 2px dashed #7c5cff;
  cursor: text;
}
.${TOOLTIP_CLASS} {
  position: absolute;
  z-index: 2147483647;
  max-width: 320px;
  background: #fff;
  color: #172b4d;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(9, 30, 66, 0.25);
  padding: 12px 14px;
  font-family: -apple-system, "Apple SD Gothic Neo", sans-serif;
  font-size: 13px;
  line-height: 1.5;
}
.${TOOLTIP_CLASS} h4 {
  margin: 0 0 6px;
  font-size: 12px;
  color: #7c5cff;
}
.${TOOLTIP_CLASS} .sunnic-tooltip-label {
  font-weight: 700;
  margin-top: 6px;
}
.${TOOLTIP_CLASS} button {
  margin-top: 10px;
  width: 100%;
  padding: 6px 10px;
  border: none;
  border-radius: 6px;
  background: #7c5cff;
  color: #fff;
  font-weight: 600;
  font-size: 12px;
  cursor: pointer;
}
.${EDIT_CONTROLS_CLASS} {
  position: absolute;
  z-index: 2147483647;
  display: flex;
  gap: 6px;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(9, 30, 66, 0.25);
  padding: 6px;
  font-family: -apple-system, "Apple SD Gothic Neo", sans-serif;
}
.${EDIT_CONTROLS_CLASS} button {
  border: none;
  border-radius: 6px;
  padding: 5px 10px;
  font-weight: 600;
  font-size: 12px;
  cursor: pointer;
}
.${EDIT_CONTROLS_CLASS} button:disabled {
  opacity: 0.6;
  cursor: default;
}
.${EDIT_CONTROLS_CLASS} [data-role="apply"] {
  background: #7c5cff;
  color: #fff;
}
.${EDIT_CONTROLS_CLASS} [data-role="cancel"] {
  background: #f4f5f7;
  color: #172b4d;
}
.${STATUS_CLASS} {
  position: absolute;
  z-index: 2147483647;
  background: #172b4d;
  color: #fff;
  border-radius: 6px;
  padding: 5px 10px;
  font-size: 12px;
  font-family: -apple-system, "Apple SD Gothic Neo", sans-serif;
}
.${STATUS_CLASS}[data-error="true"] {
  background: #a52020;
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
    if (mark.classList.contains(EDITING_CLASS)) return
    toggleTooltip(mark, issue)
  })
  return true
}

let activeTooltip: HTMLElement | null = null
let activeFloating: HTMLElement | null = null

function closeTooltip(): void {
  activeTooltip?.remove()
  activeTooltip = null
}

function closeFloating(): void {
  activeFloating?.remove()
  activeFloating = null
}

function positionNear(el: HTMLElement, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect()
  el.style.top = `${window.scrollY + rect.bottom + 6}px`
  el.style.left = `${window.scrollX + rect.left}px`
}

function toggleTooltip(mark: HTMLElement, issue: OverlayIssue): void {
  if (activeTooltip?.dataset.sunnicForIssue === issue.id) {
    closeTooltip()
    return
  }
  closeTooltip()

  const resolved = mark.classList.contains(RESOLVED_CLASS)
  const tooltip = document.createElement('div')
  tooltip.className = TOOLTIP_CLASS
  tooltip.dataset.sunnicForIssue = issue.id
  tooltip.innerHTML = `
    <h4>AI QA Service · ${issue.criteria}</h4>
    <div class="sunnic-tooltip-label">검증 이유</div>
    <div>${issue.reason}</div>
    <div class="sunnic-tooltip-label">대치 제안</div>
    <div>${issue.suggestion}</div>
    ${resolved ? '' : '<button type="button">오류 수정하기</button>'}
  `
  positionNear(tooltip, mark)

  tooltip.querySelector('button')?.addEventListener('click', (event) => {
    event.stopPropagation()
    closeTooltip()
    enterEditMode(mark, issue)
  })
  document.body.appendChild(tooltip)
  activeTooltip = tooltip
}

// "오류 수정하기"를 누르면 바로 저장하지 않고, AI 제안을 미리 채운 채로 본문 자리에서 직접 타이핑해
// 고칠 수 있는 편집 모드로 들어간다 — 사람이 본문에서 직접 눌러 고치고, "적용"을 눌렀을 때만 원문이
// 바뀌어야 한다는 요구사항 그대로. Enter로 적용, Esc로 취소도 가능하게 해서 사이드패널 없이 완결된다.
function enterEditMode(mark: HTMLElement, issue: OverlayIssue): void {
  const originalText = issue.input_text
  mark.textContent = issue.suggestion
  mark.contentEditable = 'true'
  mark.classList.add(EDITING_CLASS)
  mark.focus()

  const selection = window.getSelection()
  const range = document.createRange()
  range.selectNodeContents(mark)
  selection?.removeAllRanges()
  selection?.addRange(range)

  const controls = document.createElement('div')
  controls.className = EDIT_CONTROLS_CLASS
  controls.innerHTML = `<button type="button" data-role="apply">적용</button><button type="button" data-role="cancel">취소</button>`
  positionNear(controls, mark)
  document.body.appendChild(controls)
  activeFloating = controls

  const exitEditMode = () => {
    mark.contentEditable = 'false'
    mark.classList.remove(EDITING_CLASS)
    mark.removeEventListener('keydown', onKeydown)
    closeFloating()
  }

  const cancel = () => {
    mark.textContent = originalText
    exitEditMode()
  }

  const apply = () => {
    const newText = (mark.textContent ?? '').trim()
    exitEditMode()
    if (!newText || newText === originalText) {
      mark.textContent = originalText
      return
    }
    void applyEdit(mark, issue, originalText, newText)
  }

  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      apply()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      cancel()
    }
  }
  mark.addEventListener('keydown', onKeydown)

  controls.querySelector('[data-role="apply"]')?.addEventListener('click', (event) => {
    event.stopPropagation()
    apply()
  })
  controls.querySelector('[data-role="cancel"]')?.addEventListener('click', (event) => {
    event.stopPropagation()
    cancel()
  })
}

function showStatus(anchor: HTMLElement, message: string, isError: boolean): HTMLElement {
  closeFloating()
  const status = document.createElement('div')
  status.className = STATUS_CLASS
  status.dataset.error = String(isError)
  status.textContent = message
  positionNear(status, anchor)
  document.body.appendChild(status)
  activeFloating = status
  return status
}

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

// 실제 컨플루언스 반영: 최신 본문+버전을 받아 oldText → newText로 문자열 치환한 뒤 PUT으로 저장한다.
// 표/목록처럼 렌더링 시 텍스트가 변형되는 구간은 원본 storage HTML에 그대로 없을 수 있어 실패 처리하고,
// 문서를 깨뜨리느니 아무것도 안 하는 쪽을 택한다.
async function updatePageContent(pageId: string, oldText: string, newText: string): Promise<ApplyResult> {
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

async function applyEdit(mark: HTMLElement, issue: OverlayIssue, oldText: string, newText: string): Promise<void> {
  mark.textContent = newText
  const status = showStatus(mark, '적용 중...', false)

  const pageId = extractPageId(location.href)
  const result = pageId
    ? await updatePageContent(pageId, oldText, newText)
    : ({ ok: false, error: '컨플루언스 문서 URL이 아니라 원문에 반영할 수 없습니다.' } as const)

  if (status.isConnected) status.remove()
  if (activeFloating === status) activeFloating = null

  if (!result.ok) {
    mark.textContent = oldText
    showStatus(mark, result.error, true)
    return
  }

  mark.classList.add(RESOLVED_CLASS)
  chrome.runtime
    .sendMessage<IssueOverlayResolvedMessage>({ type: 'ISSUE_OVERLAY_RESOLVED', issueId: issue.id, editedText: newText })
    .catch(() => {
      // 사이드패널이 닫혀있어 받는 쪽이 없어도 원문 저장 자체는 이미 끝났으니 무시한다.
    })
}

export function applyIssueOverlay(issues: OverlayIssue[]): { matched: number; total: number } {
  ensureStyleInjected()
  clearIssueOverlay()
  const matched = issues.filter(wrapIssue).length
  return { matched, total: issues.length }
}

export function clearIssueOverlay(): void {
  closeTooltip()
  closeFloating()
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
  if (activeFloating && !target?.closest(`.${EDIT_CONTROLS_CLASS}, .${STATUS_CLASS}, .${HIGHLIGHT_CLASS}`)) {
    closeFloating()
  }
})

type OverlayRequest = ShowIssueOverlayRequest | ClearIssueOverlayRequest
type OverlayResponse = ShowIssueOverlayResponse | ClearIssueOverlayResponse

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
    return undefined
  },
)
