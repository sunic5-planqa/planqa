import type {
  ApplyIssueEditRequest,
  ApplyIssueEditResponse,
  ClearIssueOverlayRequest,
  ClearIssueOverlayResponse,
  IssueOverlayFocusMessage,
  OverlayIssue,
  ScrollToIssueRequest,
  ScrollToIssueResponse,
  ShowIssueOverlayRequest,
  ShowIssueOverlayResponse,
} from './messages'
import { splitQuotedSegments } from '../utils/quoteSegments'

// 문서 본문 위에 모든 이슈를 한 번에 하이라이트 박스로 표시하고, 클릭하면 통일된 "AI 제안" 말풍선(읽기
// 전용)을 보여준다. 실제 수정/저장은 여기서 하지 않고 사이드패널(오른쪽 패널)에서 하도록 포커스만
// 넘긴다 — Figma SCREEN 04: 본문 위 말풍선은 안내만, 편집은 오른쪽 "수정 진행 중..." 카드에서.
// 컨플루언스에 실제로 쓰는 fetch만 이 컨텐츠 스크립트가 대신 수행한다(세션 쿠키가 페이지와 동일 출처
// 여야 붙어서 나가므로) — 사이드패널이 APPLY_ISSUE_EDIT 요청을 보내면 여기서 처리해 응답한다.
const HIGHLIGHT_CLASS = 'sunnic-issue-highlight'
const RESOLVED_CLASS = 'sunnic-issue-resolved'
const ACTIVE_CLASS = 'sunnic-issue-active'
const TOOLTIP_CLASS = 'sunnic-issue-tooltip'
const STYLE_ID = 'sunnic-issue-overlay-style'

// Figma SCREEN 03/04의 하이라이트 박스 실측값 — 배경 채움 없이 solid 2px 보라 테두리(#b583ef)만,
// 둥근 모서리 10px. 그라데이션이 아니다. 단, "지금 오른쪽 패널에서 보고 있는 이슈"(active)만 예외로
// 그라데이션 테두리를 줘서 여러 박스 중 어디를 보고 있는지 한눈에 띄게 한다 — border-image는
// border-radius를 무시하는 CSS 한계가 있어서, padding-box/border-box 이중 background로 우회한다
// (내부는 여전히 투명 — Figma 스펙 그대로 유지).
const STYLE = `
.${HIGHLIGHT_CLASS} {
  background: transparent;
  border: 2px solid #b583ef;
  border-radius: 10px;
  padding: 1px 3px;
  cursor: pointer;
}
.${HIGHLIGHT_CLASS}.${RESOLVED_CLASS} {
  border-color: #2ea043;
}
.${HIGHLIGHT_CLASS}.${ACTIVE_CLASS} {
  border: 2.5px solid transparent;
  background: linear-gradient(transparent, transparent) padding-box, linear-gradient(135deg, #c9a9ff, #ffc9e8) border-box;
}
.${TOOLTIP_CLASS} {
  position: fixed;
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
.${TOOLTIP_CLASS} .sunnic-tooltip-quote {
  font-weight: 700;
  background: linear-gradient(135deg, #c9a9ff, #ffc9e8);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
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

// input_text가 목록/표 항목에서 나온 경우, 백엔드가 마크다운으로 평탄화할 때 넣은 "- " 불릿
// 접두사나 "| 셀 | 셀 |" 표 구분자가 모델이 그대로 인용한 원문 텍스트에 섞여 들어온다(모델은 자기가
// 받은 청크를 verbatim으로 인용하도록 지시받음 — bundled_screen_hybrid.py). 이 기호들은 실제
// 렌더링된 페이지의 <li>/<td> 텍스트엔 애초에 존재하지 않아서(순수 항목 내용뿐), 리터럴로 매칭하면
// 목록/표에서 나온 이슈는 거의 항상 못 찾는다 — 매칭 전에 걷어낸다.
function stripMarkdownArtifacts(input: string): string {
  return input
    .split('\n')
    .map((line) => line.replace(/^\s*-\s+/, '').replace(/^\s*\|\s*/, '').replace(/\s*\|\s*$/, ''))
    .join('\n')
}

// input_text의 공백/줄바꿈을 \s+로 느슨하게 치환한 정규식을 만든다 — 백엔드가 마크다운으로 평탄화하며
// 공백을 한 칸으로 접었던 것과 실제 렌더링된 HTML의 공백(여러 칸, 줄바꿈 등)이 완전히 같지 않아도
// 매칭되게 하기 위함. 이게 없으면 문단 텍스트조차 사소한 공백 차이로 못 찾는 경우가 많았다.
function buildLooseTextRegex(input: string): RegExp {
  const escaped = stripMarkdownArtifacts(input).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // 공백을 포함한 파이프 전체("공백* \| 공백*")를 한 단위로 0개 이상 공백으로 느슨화한다 — 셀 사이
  // 구분자가 실제 DOM/저장 HTML엔 아예 없을 수도 있어서, 파이프 양옆 공백까지 같이 선택적으로
  // 만들어야 한다(따로 처리하면 "\s+ \s* \s+"처럼 여전히 공백 1개 이상을 강제하게 된다).
  const loosened = escaped.replace(/\s*\\\|\s*/g, '\\s*')
  return new RegExp(loosened.replace(/\s+/g, '\\s+'))
}

interface TextSpan {
  node: Text
  start: number
  end: number
}

// body 안의(오버레이 자기 자신은 제외) 모든 텍스트 노드를 이어붙인 문자열 하나로 만들고, 각 노드가
// 그 문자열의 어느 구간을 차지하는지 기록한다. "상태: " 라벨과 그 옆의 뱃지 컴포넌트처럼, 사람 눈엔
// 한 줄이지만 실제로는 서로 다른 엘리먼트(=다른 텍스트 노드)에 걸쳐 있는 문구를 찾으려면 노드 하나씩
// 따로 검색해서는 안 되고 이렇게 이어붙인 전체 텍스트 기준으로 검색해야 한다.
function collectTextSpans(): { fullText: string; spans: TextSpan[] } {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      if (isInsideOverlayNode(node)) return NodeFilter.FILTER_REJECT
      const parentTag = node.parentElement?.tagName
      if (parentTag === 'SCRIPT' || parentTag === 'STYLE') return NodeFilter.FILTER_REJECT
      return NodeFilter.FILTER_ACCEPT
    },
  })

  let fullText = ''
  const spans: TextSpan[] = []
  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    const text = current.textContent ?? ''
    if (!text) continue
    spans.push({ node: current as Text, start: fullText.length, end: fullText.length + text.length })
    fullText += text
  }
  return { fullText, spans }
}

const marksByIssueId = new Map<string, HTMLElement[]>()
const issuesById = new Map<string, OverlayIssue>()

let activeIssueId: string | null = null

// "지금 보고 있는" 박스 하나에만 그라데이션 테두리(ACTIVE_CLASS)를 준다 — 클릭이든 오른쪽 패널
// 네비게이션(scrollToIssue)이든 이슈 포커스가 바뀌는 모든 경로가 이걸 거친다.
function setActiveMark(issueId: string): void {
  if (activeIssueId && activeIssueId !== issueId) {
    for (const mark of marksByIssueId.get(activeIssueId) ?? []) mark.classList.remove(ACTIVE_CLASS)
  }
  for (const mark of marksByIssueId.get(issueId) ?? []) mark.classList.add(ACTIVE_CLASS)
  activeIssueId = issueId
}

function attachIssueMarkHandlers(mark: HTMLElement, issue: OverlayIssue): void {
  mark.className = HIGHLIGHT_CLASS
  mark.dataset.sunnicIssueId = issue.id
  mark.addEventListener('click', (event) => {
    event.stopPropagation()
    // 이미 이 이슈의 말풍선이 떠 있는 채로 같은 박스를 다시 누르면 닫는다(토글) — 다른 이슈를
    // 보다가 이 박스를 누른 거면 그냥 새로 연다.
    if (activeTooltip?.dataset.sunnicForIssue === issue.id) closeTooltip()
    else showTooltip(mark, issue)
    setActiveMark(issue.id)
    chrome.runtime.sendMessage<IssueOverlayFocusMessage>({ type: 'ISSUE_OVERLAY_FOCUS', issueId: issue.id }).catch(() => {
      // 사이드패널이 닫혀있으면 받는 쪽이 없어도 말풍선 표시 자체는 유효하니 무시한다.
    })
  })
}

function normalizeHeadingText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

// input_text로 못 찾을 때의 최후 수단 — "정보 누락(MI)"처럼 애초에 원문에 없는 걸 지적하는 이슈는
// 매치 대상 자체가 없어서 항상 여기로 온다(그 외 사소한 매칭 실패의 안전망 역할도 겸함). issue.location
// (예: "6. 프로덕트 기능 > 6-1. 메인 배너 (캐러셀)")의 가장 안쪽 위계와 텍스트가 일치하는 제목(h1~h6)을
// 찾아 그 제목 자체를 감싼다 — location은 htmlToChapterMarkdown이 만든 헤딩 텍스트 그대로라 실제
// 문서 제목과 일치해야 정상이다. 이렇게라도 하이라이트가 있어야 "다음"으로 넘겼을 때 문서가 스크롤돼
// 어느 부분을 고쳐야 하는지 보여줄 수 있다 — 정밀한 range/insert_range 프레임 렌더링은 아직 없음.
function wrapIssueByLocationHeading(issue: OverlayIssue): boolean {
  // location이 없는 이슈(예: 이 필드가 추가되기 전에 저장/캐시된 예전 데이터)가 섞여 들어와도 여기서
  // 죽지 않게 방어한다 — 이 함수 하나가 던지면 호출부의 filter() 전체가 멈춰서, 뒤에 있던 멀쩡한
  // 이슈들의 하이라이트까지 통째로 사라지는 사고로 이어진다(실제로 한번 겪음).
  const target = normalizeHeadingText(issue.location?.split('>').pop() ?? '')
  if (!target) return false

  // h1은 일부러 뺀다 — review-agent의 Document 위계(문서 전체를 대상으로 한 판정) 이슈는
  // location이 곧 "문서 제목"이라서(백엔드 document.py의 _doc_title), 여길 막지 않으면 컨플루언스
  // 페이지 자체의 제목(h1)을 감싸버려 "제목이 문제"인 것처럼 보이는 엉뚱한 하이라이트가 된다(실제
  // 사용자 보고). 본문 소제목(h2~h6)만 유효한 폴백 대상 — 못 찾으면 하이라이트 없이 넘어간다.
  const heading = Array.from(document.querySelectorAll<HTMLElement>('h2, h3, h4, h5, h6')).find(
    (h) => !isInsideOverlayNode(h) && normalizeHeadingText(h.textContent ?? '') === target,
  )
  if (!heading) return false

  const mark = document.createElement('mark')
  attachIssueMarkHandlers(mark, issue)
  while (heading.firstChild) mark.appendChild(heading.firstChild)
  heading.appendChild(mark)

  marksByIssueId.set(issue.id, [mark])
  issuesById.set(issue.id, issue)
  return true
}

// 프레이밍(본문 하이라이트) 실패의 정확한 원인은 실사용 보고만으로는 알 수 없다(엔티티 인코딩,
// 목록/표 합성 기호, 매크로 렌더링 차이 등 여러 후보가 있었고 그때마다 재현 데이터가 있어야
// 고칠 수 있었다) — 실패 시 콘솔에 실제 본문 텍스트 조각을 남겨서 다음 재현 보고와 함께 바로
// 진단할 수 있게 한다. logStorageMatchFailure(저장 실패용)와 같은 패턴.
function logFramingMatchFailure(fullText: string, inputText: string): void {
  const probe = inputText.slice(0, 15)
  const probeIndex = fullText.indexOf(probe)
  if (probeIndex === -1) {
    console.warn('[SunniC] input_text 앞부분조차 본문에서 찾지 못함:', { probe, inputTextLength: inputText.length })
    return
  }
  const context = fullText.slice(Math.max(0, probeIndex - 20), probeIndex + inputText.length + 60)
  console.warn('[SunniC] input_text 앞부분은 찾았지만 전체 매칭 실패. input_text와 실제 본문을 비교해보세요:', {
    inputText,
    surroundingText: context,
  })
}

// issue.input_text와 일치하는 구간을 찾아 하이라이트한다. 매치가 텍스트 노드 하나에 다 들어있으면
// <mark> 하나로 감싸고, 라벨+뱃지처럼 여러 노드에 걸쳐 있으면 겹치는 구간마다 각각 <mark>로 감싸서
// (같은 issue id를 공유) 이어 붙은 것처럼 보이게 한다 — Range.surroundContents는 엘리먼트 경계를
// 넘나드는 단일 범위를 감쌀 수 없어서, 노드별로 쪼개 감싸는 쪽을 택했다.
function wrapIssue(issue: OverlayIssue): boolean {
  const { fullText, spans } = collectTextSpans()
  const match = buildLooseTextRegex(issue.input_text).exec(fullText)
  if (!match) {
    if (issue.input_text) logFramingMatchFailure(fullText, issue.input_text)
    return wrapIssueByLocationHeading(issue)
  }

  const matchStart = match.index
  const matchEnd = match.index + match[0].length
  const marks: HTMLElement[] = []

  for (const span of spans) {
    const overlapStart = Math.max(matchStart, span.start)
    const overlapEnd = Math.min(matchEnd, span.end)
    if (overlapStart >= overlapEnd) continue

    const range = document.createRange()
    range.setStart(span.node, overlapStart - span.start)
    range.setEnd(span.node, overlapEnd - span.start)

    const mark = document.createElement('mark')
    attachIssueMarkHandlers(mark, issue)
    range.surroundContents(mark)
    marks.push(mark)
  }

  if (marks.length === 0) return wrapIssueByLocationHeading(issue)
  marksByIssueId.set(issue.id, marks)
  issuesById.set(issue.id, issue)
  return true
}

let activeTooltip: HTMLElement | null = null
let activeAnchorMark: HTMLElement | null = null
let repositionRafId: number | null = null

function closeTooltip(): void {
  activeTooltip?.remove()
  activeTooltip = null
  activeAnchorMark = null
  window.removeEventListener('scroll', repositionActiveTooltip, true)
  window.removeEventListener('resize', repositionActiveTooltip)
  if (repositionRafId !== null) {
    cancelAnimationFrame(repositionRafId)
    repositionRafId = null
  }
}

// scroll 이벤트만 믿고 재계산하면, scrollIntoView가 시작되기도 전(같은 틱)에 읽은 첫 rect가
// "스크롤 전 옛 위치" 그대로 굳어버리는 경우가 있다 — 어떤 스크롤 컨테이너를 컨플루언스가 쓰든,
// 애니메이션이 스크롤 이벤트를 우리가 잡을 수 있는 타이밍/방식으로 안 낼 수도 있어서. 이벤트에
// 의존하는 대신 열리고 나서 한동안(smooth scrollIntoView가 끝나기 충분한 시간) 매 프레임 강제로
// 다시 계산해 최종적으로는 항상 실제 위치에 맞게 만든다.
function startContinuousReposition(durationMs: number): void {
  if (repositionRafId !== null) cancelAnimationFrame(repositionRafId)
  const deadline = performance.now() + durationMs
  const tick = () => {
    if (!activeTooltip || !activeAnchorMark) {
      repositionRafId = null
      return
    }
    positionNear(activeTooltip, activeAnchorMark)
    repositionRafId = performance.now() < deadline ? requestAnimationFrame(tick) : null
  }
  repositionRafId = requestAnimationFrame(tick)
}

// scrollToIssue()가 scrollIntoView({behavior:'smooth'})로 스크롤을 걸어 놓고 바로 이어서 말풍선을
// 띄우면, 그 시점의 mark 위치는 아직 스크롤 애니메이션이 끝나기 전(도착지가 아닌) 값이라 말풍선이
// 엉뚱한 곳에 자리잡는다 — "어떤 이슈는 말풍선이 뜨는데 어떤 건 안 뜨는" 것처럼 보였던 원인. 스크롤
// 애니메이션이 끝날 때까지 기다리는 대신, 열려 있는 동안 스크롤/리사이즈마다 위치를 계속 다시 계산해서
// 애니메이션이 어떻게 끝나든 최종적으로는 항상 mark 바로 아래에 오도록 한다. capture:true라 컨플루언스
// 내부의 어떤 스크롤 컨테이너(꼭 window가 아니어도)에서 스크롤이 나도 잡아낸다.
function repositionActiveTooltip(): void {
  if (activeTooltip && activeAnchorMark) positionNear(activeTooltip, activeAnchorMark)
}

// position:fixed 기준이라 스크롤 오프셋을 더하면 안 된다 — viewport 좌표 그대로 쓴다.
// body/상위 요소에 position:relative 같은 게 있는 실제 컨플루언스 페이지에서도(대부분의 경우) 정확한
// 위치에 뜨게 하려고 absolute 대신 fixed를 쓴다(transform/filter가 걸린 조상만 예외).
function positionNear(el: HTMLElement, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect()
  el.style.top = `${rect.bottom + 6}px`
  el.style.left = `${rect.left}px`
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// AI 제안 문장 전체를 다 강조하면 오히려 뭐가 핵심인지 안 보인다 — 따옴표로 감싼 부분(예: '핵클
// SDK 연동...'처럼 구체적인 대안/인용구)만 골라 그라데이션으로 강조한다. 분리 로직 자체는
// utils/quoteSegments.ts에서 사이드패널(React)과 공유 — 여기서는 HTML 문자열로 조립하는 부분만.
function highlightQuotedSpans(text: string): string {
  return splitQuotedSegments(text)
    .map((segment) =>
      segment.quoted ? `<span class="sunnic-tooltip-quote">${escapeHtml(segment.text)}</span>` : escapeHtml(segment.text),
    )
    .join('')
}

// 통일된 읽기 전용 "AI 제안" 말풍선 — 어떤 이슈든 항상 같은 모양(제목 + 제안 한 줄)이고 버튼이 없다.
// 실제 수정은 오른쪽 패널에서 하므로 여기서는 안내만 한다. 항상 열기만 하고(닫힌 상태 유지는 호출부
// 책임) — 오른쪽 패널에서 이슈를 옮겨다닐 때도 이 함수로 자동으로 띄운다.
function showTooltip(mark: HTMLElement, issue: OverlayIssue): void {
  closeTooltip()

  const tooltip = document.createElement('div')
  tooltip.className = TOOLTIP_CLASS
  tooltip.dataset.sunnicForIssue = issue.id
  tooltip.innerHTML = `
    <div class="sunnic-tooltip-heading">AI 제안</div>
    <div>${highlightQuotedSpans(issue.suggestion)}</div>
  `
  positionNear(tooltip, mark)
  // body가 아니라 html에 직접 붙인다 — 실제 컨플루언스 페이지의 body(또는 그 사이 어딘가)에
  // transform/filter가 걸려 있으면 그게 fixed 요소의 containing block이 돼버려서 위치가 또
  // 틀어질 수 있는데, html까지 그런 경우는 사실상 없다.
  document.documentElement.appendChild(tooltip)
  activeTooltip = tooltip
  activeAnchorMark = mark
  window.addEventListener('scroll', repositionActiveTooltip, true)
  window.addEventListener('resize', repositionActiveTooltip)
  // smooth scrollIntoView는 보통 500ms 안팎에 끝난다 — 800ms면 여유 있게 덮는다. 그 이후로도
  // 열려 있는 동안의 스크롤/리사이즈는 위 이벤트 리스너가 계속 처리한다.
  startContinuousReposition(800)
}

export function applyIssueOverlay(issues: OverlayIssue[]): { matched: number; total: number } {
  ensureStyleInjected()
  clearIssueOverlay()
  // 이슈 하나에서 예상 못 한 에러가 나도(예: 데이터 이상) filter() 전체를 멈추지 않게 감싼다 —
  // 그러지 않으면 그 이슈 뒤에 있는 멀쩡한 이슈들까지 전부 하이라이트가 안 그려진다.
  const matched = issues.filter((issue) => {
    try {
      return wrapIssue(issue)
    } catch (error) {
      console.warn('[SunniC] 이슈 하이라이트 실패:', issue.id, error)
      return false
    }
  }).length
  return { matched, total: issues.length }
}

export function clearIssueOverlay(): void {
  closeTooltip()
  marksByIssueId.clear()
  issuesById.clear()
  activeIssueId = null
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

// 컨플루언스 URL(/pages/{id}/..., /pages/edit-v2/{id} 등 또는 ?pageId=)에서 페이지 id를 뽑는다.
// confluence-extractor.ts와 동일 로직(그쪽의 edit-v2 URL 인식 수정과 동기화됨) — content script
// 진입점끼리 import로 얽히면 각자 번들에 onMessage 리스너가 중복 등록될 위험이 있어 이 작은
// 순수함수만 그대로 복제해서 둔다.
function extractPageId(url: string): string | null {
  const pathMatch = url.match(/\/pages\/(?:[\w-]+\/)?(\d+)/)
  if (pathMatch) return pathMatch[1]
  const queryMatch = url.match(/[?&]pageId=(\d+)/)
  return queryMatch ? queryMatch[1] : null
}

type ApplyResult = { ok: true } | { ok: false; error: string }

// <textarea>.innerHTML → .value 트릭으로 named/numeric HTML 엔티티를 브라우저가 아는 그대로
// 디코딩한다 — &rarr; 같은 엔티티를 전부 나열한 표를 직접 관리하지 않아도 된다.
const entityDecoder = document.createElement('textarea')
function decodeHtmlEntity(raw: string): string {
  entityDecoder.innerHTML = raw
  return entityDecoder.value
}

// storage HTML을 한 번 훑으면서 태그(<...>)는 건너뛰고 텍스트만 이어붙이되, 디코딩된 글자 하나하나가
// 원본 문자열의 어느 바이트 구간에서 왔는지 같이 기록한다. 예전엔 "디코딩한 텍스트를 원본 문자열
// 안에서 다시 찾기"(indexOf) 방식이었는데, &rarr; 처럼 엔티티로 인코딩된 문자가 매치 구간 안에 하나만
// 있어도 디코딩된 문자가 원본에 그대로 존재하지 않아 못 찾는 문제가 있었다(실제 DOC-001에서 확인).
// 이렇게 스캔과 동시에 오프셋을 기록해두면 나중엔 역산만 하면 되니 그 문제 자체가 생기지 않는다 —
// 목록/표처럼 문구가 여러 엘리먼트(태그)에 걸친 경우도 태그를 그냥 건너뛰는 것만으로 자연히 처리된다.
function decodeStorageHtmlText(html: string): { fullText: string; rawRanges: Array<[number, number]> } {
  let fullText = ''
  const rawRanges: Array<[number, number]> = []
  let i = 0
  while (i < html.length) {
    const ch = html[i]
    if (ch === '<') {
      const close = html.indexOf('>', i)
      i = close === -1 ? html.length : close + 1
      continue
    }
    if (ch === '&') {
      const semi = html.indexOf(';', i)
      if (semi !== -1 && semi - i <= 32) {
        const raw = html.slice(i, semi + 1)
        const decoded = decodeHtmlEntity(raw)
        if (decoded !== raw) {
          for (const decodedChar of decoded) {
            fullText += decodedChar
            rawRanges.push([i, semi + 1])
          }
          i = semi + 1
          continue
        }
      }
    }
    fullText += ch
    rawRanges.push([i, i + 1])
    i += 1
  }
  return { fullText, rawRanges }
}

// storage HTML에서 oldText(공백은 느슨하게)를 찾아 newText로 치환한다. 매치 구간을 raw 오프셋으로
// 역산한 뒤, 그 구간 [rawStart, rawEnd) 안을 다시 한번 훑어서 태그(<strong>, </li> 등)는 전부 그대로
// 보존하고 실제 매치된 텍스트만 한 곳에 newText로 몰아 넣는다 — [rawStart, rawEnd)를 통째로 잘라내고
// newText로 바꿔버리면, <strong>A</strong><br>B처럼 매치가 태그 경계에 걸친 경우 여는 태그만 남고
// 닫는 태그가 같이 지워져서 마크업이 깨진다.
function replaceInStorageHtml(html: string, oldText: string, newText: string): string | null {
  const { fullText, rawRanges } = decodeStorageHtmlText(html)
  const match = buildLooseTextRegex(oldText).exec(fullText)
  if (!match || match[0].length === 0) return null

  const matchStart = match.index
  const matchEnd = match.index + match[0].length
  const rawStart = rawRanges[matchStart][0]
  const rawEnd = rawRanges[matchEnd - 1][1]

  let middle = ''
  let inserted = false
  let i = rawStart
  while (i < rawEnd) {
    if (html[i] === '<') {
      const close = html.indexOf('>', i)
      const tagEnd = close === -1 ? rawEnd : Math.min(close + 1, rawEnd)
      middle += html.slice(i, tagEnd)
      i = tagEnd
      continue
    }
    if (!inserted) {
      middle += newText
      inserted = true
    }
    i += 1
  }
  if (!inserted) middle += newText

  return html.slice(0, rawStart) + middle + html.slice(rawEnd)
}

// 매칭이 끝내 실패했을 때, 왜 실패했는지 다음 조사를 위해 콘솔에 실제 원본 조각을 남긴다 — 여기서
// 계속 실패한다는 보고가 반복되는데 여기 로그가 없으면 실제 storage HTML이 정확히 어떻게 생겼는지
// 확인할 방법이 없다(엔티티 인코딩, 예상 못 한 태그 등 원격으로는 추측만 가능한 경우들 때문).
function logStorageMatchFailure(html: string, oldText: string): void {
  const probe = oldText.slice(0, 15)
  const probeIndex = html.indexOf(probe)
  if (probeIndex === -1) {
    console.warn('[SunniC] 원문 앞부분조차 storage HTML에서 찾지 못함:', { probe, oldTextLength: oldText.length })
    return
  }
  const context = html.slice(Math.max(0, probeIndex - 20), probeIndex + oldText.length + 60)
  console.warn('[SunniC] 원문 앞부분은 찾았지만 전체 매칭 실패. oldText와 실제 주변 HTML을 비교해보세요:', {
    oldText,
    surroundingHtml: context,
  })
}

// pageId가 가리키는 페이지의 body.storage에서 oldText → newText로 문자열 치환한 뒤 PUT으로 저장한다.
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
  const updatedHtml = replaceInStorageHtml(html, oldText, newText)
  if (updatedHtml === null) {
    logStorageMatchFailure(html, oldText)
    return { ok: false, error: '원문에서 해당 문구를 찾지 못했습니다.' }
  }

  const putRes = await fetch(`${location.origin}/wiki/rest/api/content/${pageId}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Atlassian-Token': 'no-check' },
    body: JSON.stringify({
      version: { number: data.version.number + 1 },
      title: data.title,
      type: 'page',
      body: { storage: { value: updatedHtml, representation: 'storage' } },
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

// timeZone: 'Asia/Seoul'을 명시한 toLocaleString도 실제 서비스 환경에서 여전히 몇 시간씩
// 어긋난다는 보고가 있었다(Intl 구현/브라우저 설정에 따라 달라질 수 있는 여지가 남아있는 듯) —
// 그래서 Intl에 아예 기대지 않는 방식으로 바꾼다. Date.getTime()의 epoch ms는 시간대와 무관한
// 절대 시각이므로, 여기에 KST 오프셋(UTC+9, 서머타임이 없어 연중 고정)을 직접 더한 뒤 UTC
// getter로 값을 읽으면 실행 환경(Intl 지원 수준, 시스템 시간대 설정)에 전혀 의존하지 않는 순수
// 산술 계산만으로 항상 정확한 한국 시각을 얻는다.
export function formatKstTimestamp(date: Date): string {
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000
  const kst = new Date(date.getTime() + KST_OFFSET_MS)
  const pad = (n: number) => String(n).padStart(2, '0')
  const hour24 = kst.getUTCHours()
  const ampm = hour24 < 12 ? '오전' : '오후'
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12
  return (
    `${kst.getUTCFullYear()}. ${kst.getUTCMonth() + 1}. ${kst.getUTCDate()}. ` +
    `${ampm} ${hour12}:${pad(kst.getUTCMinutes())}:${pad(kst.getUTCSeconds())}`
  )
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

  const title = `${original.title} (QA 검토 수정본 ${formatKstTimestamp(new Date())})`
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

// 저장이 실제로 반영되는 곳(복제본)과 지금 보고 있는 화면(원본)이 다르므로, 저장 성공 후에도 그냥
// 두면 화면엔 여전히 고치기 전 원문이 남아있어 사용자가 "진짜 반영됐나?" 헷갈린다. 그래서 성공하면
// 왼쪽 문서에서도 그 자리를 새 텍스트로 덮어써서 눈으로 바로 확인되게 한다 — 실제 저장 대상(복제본)과
// 무관하게 순수 로컬 DOM 표시일 뿐이다. 매치가 여러 엘리먼트에 걸쳐 나뉜 경우(라벨+뱃지 등) 전부를
// 정확히 나눠 넣을 방법이 없어 첫 mark에 새 텍스트를 몰아넣고 나머지는 비워 하나로 합친다.
function overwriteMarkText(issueId: string, newText: string): void {
  const marks = marksByIssueId.get(issueId)
  if (!marks || marks.length === 0) return
  const [first, ...rest] = marks
  first.textContent = newText
  for (const extra of rest) extra.remove()
  marksByIssueId.set(issueId, [first])
}

export async function applyIssueEdit(issueId: string, oldText: string, newText: string): Promise<ApplyIssueEditResponse> {
  const originalPageId = extractPageId(location.href)
  if (!originalPageId) return { ok: false, error: '컨플루언스 문서 URL이 아니라 복제본을 만들 수 없습니다.' }

  const session = await ensureDuplicateSession(originalPageId)
  if (!session.ok) return session

  const result = await replaceTextAndSave(session.pageId, oldText, newText)
  if (!result.ok) return result

  overwriteMarkText(issueId, newText)
  for (const mark of marksByIssueId.get(issueId) ?? []) mark.classList.add(RESOLVED_CLASS)
  closeTooltip()
  return { ok: true }
}

// 오른쪽 패널에서 이슈가 바뀔 때(이전/다음, Overview 카드 클릭 등) 호출 — 해당 박스로 스크롤하는
// 동시에 그 이슈의 AI 제안 말풍선도 자동으로 띄운다. 문서에서 직접 클릭해야만 말풍선이 보이던 걸,
// 오른쪽에서 옮겨다닐 때도 굳이 왼쪽을 따로 클릭할 필요 없게 만든 것.
export function scrollToIssue(issueId: string): boolean {
  const mark = marksByIssueId.get(issueId)?.[0]
  const issue = issuesById.get(issueId)
  if (!mark || !issue) return false
  mark.scrollIntoView({ behavior: 'smooth', block: 'center' })
  showTooltip(mark, issue)
  setActiveMark(issueId)
  return true
}

type OverlayRequest = ShowIssueOverlayRequest | ClearIssueOverlayRequest | ApplyIssueEditRequest | ScrollToIssueRequest
type OverlayResponse = ShowIssueOverlayResponse | ClearIssueOverlayResponse | ApplyIssueEditResponse | ScrollToIssueResponse

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
    if (message.type === 'SCROLL_TO_ISSUE') {
      sendResponse({ ok: scrollToIssue(message.issueId) })
      return true
    }
    if (message.type === 'APPLY_ISSUE_EDIT') {
      void applyIssueEdit(message.issueId, message.oldText, message.newText).then(sendResponse)
      return true
    }
    return undefined
  },
)
