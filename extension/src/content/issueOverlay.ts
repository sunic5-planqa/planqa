import type {
  ClearIssueOverlayRequest,
  ClearIssueOverlayResponse,
  IssueOverlayResolvedMessage,
  OverlayIssue,
  ShowIssueOverlayRequest,
  ShowIssueOverlayResponse,
} from './messages'

// 사이드패널 이슈 목록과 별개로, 문서 본문 위에 직접 하이라이트 박스 + "AI 제안" 툴팁을 그려주는 오버레이.
// Figma SCREEN 03/04 목업과 동일한 위치(본문 위)에서 인라인 수정을 할 수 있게 한다.
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
  cursor: default;
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
    toggleTooltip(mark, issue)
  })
  return true
}

let activeTooltip: HTMLElement | null = null

function closeTooltip(): void {
  activeTooltip?.remove()
  activeTooltip = null
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

  const rect = mark.getBoundingClientRect()
  tooltip.style.top = `${window.scrollY + rect.bottom + 6}px`
  tooltip.style.left = `${window.scrollX + rect.left}px`

  tooltip.querySelector('button')?.addEventListener('click', (event) => {
    event.stopPropagation()
    resolveIssue(mark, issue)
  })
  document.body.appendChild(tooltip)
  activeTooltip = tooltip
}

function resolveIssue(mark: HTMLElement, issue: OverlayIssue): void {
  mark.textContent = issue.suggestion
  mark.classList.add(RESOLVED_CLASS)
  closeTooltip()
  chrome.runtime
    .sendMessage<IssueOverlayResolvedMessage>({ type: 'ISSUE_OVERLAY_RESOLVED', issueId: issue.id, editedText: issue.suggestion })
    .catch(() => {
      // 사이드패널이 닫혀있어 받는 쪽이 없어도 문서 위 시각적 수정 자체는 유효하므로 무시한다.
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
