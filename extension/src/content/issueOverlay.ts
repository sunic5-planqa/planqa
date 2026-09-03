import { api } from '../api/client'
import { isIssueLikelyResolved } from '../state/editValidation'
import type {
  ApplyIssueEditRequest,
  ApplyIssueEditResponse,
  ClearActiveSuggestionRequest,
  ClearActiveSuggestionResponse,
  ClearQaPassedBadgeRequest,
  CommitDocumentEditsRequest,
  CommitDocumentEditsResponse,
  EditableSuggestionLocation,
  GetActiveDuplicatePageRequest,
  GetActiveDuplicatePageResponse,
  QaPassedBadgeResponse,
  ScrollToLocationRequest,
  ScrollToLocationResponse,
  SetActiveSuggestionRequest,
  SetActiveSuggestionResponse,
  ShowQaPassedBadgeRequest,
  SuggestionEditSavedMessage,
  SuggestionLocation,
} from './messages'

// 지금 작업 중인 제안의 위치(current/related/done)만 문단 단위로 틴트 표시하고, 나머지 문단은
// 흐리게(dim) 만든다 — 다만 편집 가능 여부는 이제 틴트와 무관하다: 표시된 문단만 고칠 수 있게
// 막아둔 게 오히려 불편하다는 실사용 피드백(2026-08-30)으로, 문서 전체를 항상 편집 가능하게
// 열어둔다. 틴트는 순수하게 "AI가 지목한 위치"라는 시각적 안내로만 남는다. 저장은 여기서 직접
// 수행한다 — 컨텐츠 스크립트가 페이지와 동일 출처라 세션 쿠키로 컨플루언스 REST API를 호출할
// 수 있어서다. 저장 시 실제로 바뀐 문단이 몇 개든 전부 하나의 저장 요청에 담아 반영하고,
// 그중 current 문단의 새 텍스트로 SUGGESTION_EDIT_SAVED를 사이드패널에 알려 다음 제안으로
// 넘어가게 한다(패널은 issueId를 이미 알고 있으므로 그쪽에서 상태를 갱신).
const CURRENT_CLASS = 'sunnic-loc-current'
const RELATED_CLASS = 'sunnic-loc-related'
const DONE_CLASS = 'sunnic-loc-done'
const DIM_CLASS = 'sunnic-loc-dim'
const FLASH_CLASS = 'sunnic-scroll-flash'
const QA_BADGE_CLASS = 'sunnic-qa-passed-badge'
const EDIT_ACTIONS_CLASS = 'sunnic-edit-actions'
const STYLE_ID = 'sunnic-issue-overlay-style'

// 문단 단위 앵커로 볼 블록 엘리먼트들 — 표/리스트/제목까지 포함해야 실제 문서 구조를 커버한다.
const BLOCK_SELECTOR = 'p, li, td, th, blockquote, h2, h3, h4, h5, h6'

// 최종 스펙(2026-08-30 정리) — 배경 틴트만으로 위치를 표시한다. 예전엔 border-left 세로 바 +
// ::before 원형 마커 + 전체 테두리까지 겹쳐서 붙였는데("스크롤은 되는데 표시가 없다"는 실사용
// 보고 대응용으로 한 겹씩 추가해온 결과), 정작 디버그 아웃라인처럼 보인다는 피드백으로 전부
// 걷어내고 배경색+살짝 둥근 모서리만 남긴다. border-radius는 세 상태가 공유하므로 한 군데
// (이 셀렉터)에서만 관리한다.
const STYLE = `
.${CURRENT_CLASS}, .${RELATED_CLASS}, .${DONE_CLASS} {
  border-radius: 8px;
  transition: background-color .22s ease;
}
/* current(지금 보는 위치)와 related(같은 이슈의 다른 위치)를 예전엔 다른 색(보라/핑크)으로
   구분했는데, 어느 쪽을 먼저 고칠지는 AI가 임의로 정한 순서일 뿐 실제로는 기획자가 문서를 보고
   판단할 몫이다 — 색으로 "여기가 먼저"라는 인상을 주면 안 된다는 피드백(2026-08-30)으로 둘을
   같은 색으로 통일한다. 구분은 내비게이터(‹›)의 "1/2" 텍스트로만 한다. */
.${CURRENT_CLASS}, .${RELATED_CLASS} {
  background: rgba(180, 122, 207, .22);
  cursor: text;
}
.${DONE_CLASS} {
  position: relative;
  background: rgba(52, 168, 83, .14);
}
.${DONE_CLASS}::before {
  content: '\\2713';
  position: absolute;
  left: -20px;
  top: 50%;
  transform: translateY(-50%);
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: #34A853;
  color: #fff;
  font-size: 9px;
  line-height: 15px;
  text-align: center;
}
.${DIM_CLASS} {
  opacity: .4;
  transition: opacity .22s ease;
}
.${CURRENT_CLASS}[contenteditable='true'] {
  outline: none;
  cursor: text;
}
.${FLASH_CLASS} {
  animation: sunnic-scroll-flash-anim 1.2s ease;
}
@keyframes sunnic-scroll-flash-anim {
  0% { background-color: rgba(201, 169, 255, .25); }
  100% { background-color: transparent; }
}
.${QA_BADGE_CLASS} {
  display: inline-flex;
  align-items: center;
  margin-left: 10px;
  padding: 5px 12px;
  border-radius: 20px;
  background: #F2F9F4;
  border: 1px solid #DCEDE2;
  color: #3F6B4C;
  font-size: 11px;
  font-weight: 700;
  vertical-align: middle;
}
.${EDIT_ACTIONS_CLASS} {
  position: fixed;
  z-index: 2147483647;
  max-width: 280px;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(9, 30, 66, .25);
  padding: 10px 12px;
  font-family: -apple-system, "Apple SD Gothic Neo", sans-serif;
}
.${EDIT_ACTIONS_CLASS}-notice {
  margin-bottom: 6px;
  font-size: 11px;
  line-height: 1.5;
  color: #6E6B79;
}
.${EDIT_ACTIONS_CLASS}-notice:empty {
  display: none;
}
.${EDIT_ACTIONS_CLASS}-row {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
.${EDIT_ACTIONS_CLASS} button {
  border: none;
  background: none;
  padding: 0;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
  flex: none;
}
.${EDIT_ACTIONS_CLASS}-cancel {
  color: #939393;
}
.${EDIT_ACTIONS_CLASS}-save {
  color: #6B4FC0;
}
.${EDIT_ACTIONS_CLASS} button:disabled {
  opacity: .5;
  cursor: default;
}
`

function ensureStyleInjected(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = STYLE
  document.head.appendChild(style)
}

// 우리가 직접 주입한 장식 요소(QA 통과 배지, 저장/취소 플로팅 박스) 안의 텍스트 노드는 문서 본문
// 매칭 대상에서 제외한다 — 배지는 "✓ QA 통과", 플로팅 박스는 "취소"/"저장" 같은 실제 텍스트를
// 갖고 있어 다음 매칭에 잘못 걸릴 수 있다(플로팅 박스는 document.documentElement에 붙어 원래
// document.body 트리워커에 안 잡히지만, 방어적으로 같이 걸러둔다).
function isInsideOverlayNode(node: Node): boolean {
  const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element)
  return !!element?.closest(`.${QA_BADGE_CLASS}, .${EDIT_ACTIONS_CLASS}`)
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
  // 줄바꿈 경계(예: 서로 다른 <li> 항목을 이어붙여 인용한 경우)는 0개 이상 공백으로 느슨화한다 —
  // 인접한 블록 요소 사이에 실제 DOM/저장 HTML엔 공백 문자가 아예 없을 수도 있다(파이프 케이스와
  // 같은 이유). 문장 내부의 일반 공백은 최소 1개는 있다고 보고 그대로 \s+로 둔다 — 순서가 중요:
  // 줄바꿈을 먼저 \s*로 바꿔야 그 문자가 뒤 단계의 일반 공백 처리(\s+)에 다시 걸리지 않는다.
  const withLooseLineBreaks = loosened.replace(/\n/g, '\\s*')
  return new RegExp(withLooseLineBreaks.replace(/[ \t]+/g, '\\s+'))
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

function normalizeHeadingText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

// 프레이밍(본문 매칭) 실패의 정확한 원인은 실사용 보고만으로는 알 수 없다(엔티티 인코딩, 목록/표
// 합성 기호, 매크로 렌더링 차이 등 여러 후보가 있었고 그때마다 재현 데이터가 있어야 고칠 수
// 있었다) — 실패 시 콘솔에 실제 본문 텍스트 조각을 남겨서 다음 재현 보고와 함께 바로 진단할 수
// 있게 한다.
function logFramingMatchFailure(fullText: string, inputText: string): void {
  const probe = inputText.slice(0, 15)
  const probeIndex = fullText.indexOf(probe)
  if (probeIndex === -1) {
    console.warn('[SunniC] 위치 텍스트 앞부분조차 본문에서 찾지 못함:', { probe, inputTextLength: inputText.length })
    return
  }
  const context = fullText.slice(Math.max(0, probeIndex - 20), probeIndex + inputText.length + 60)
  console.warn('[SunniC] 위치 텍스트 앞부분은 찾았지만 전체 매칭 실패. text와 실제 본문을 비교해보세요:', {
    inputText,
    surroundingText: context,
  })
}

// input_text로 못 찾을 때의 최후 수단 — "정보 누락(MI)"처럼 애초에 원문에 없는 걸 지적하는 위치는
// 매치 대상 자체가 없어서 항상 여기로 온다(그 외 사소한 매칭 실패의 안전망 역할도 겸함). location
// (예: "6. 프로덕트 기능 > 6-1. 메인 배너 (캐러셀)")의 가장 안쪽 위계와 텍스트가 일치하는 제목
// (h2~h6)을 찾아 그 제목 엘리먼트 자체를 앵커로 돌려준다.
function findHeadingAnchor(location: string | null): HTMLElement | null {
  const target = normalizeHeadingText(location?.split('>').pop() ?? '')
  if (!target) return null

  // h1은 일부러 뺀다 — review-agent의 Document 위계(문서 전체를 대상으로 한 판정) 이슈는 location이
  // 곧 "문서 제목"이라서(백엔드 document.py의 _doc_title), 여길 막지 않으면 컨플루언스 페이지
  // 자체의 제목(h1)을 틴트해버려 "제목이 문제"인 것처럼 보이는 엉뚱한 표시가 된다. 본문 소제목
  // (h2~h6)만 유효한 폴백 대상 — 못 찾으면 앵커 없이 넘어간다.
  return (
    Array.from(document.querySelectorAll<HTMLElement>('h2, h3, h4, h5, h6')).find(
      (h) => !isInsideOverlayNode(h) && normalizeHeadingText(h.textContent ?? '') === target,
    ) ?? null
  )
}

// location의 text를 문서에서 찾아, 그 텍스트를 담고 있는 문단/리스트항목/셀/제목 등 블록 엘리먼트를
// 앵커로 돌려준다(예전처럼 매치된 글자 구간만 <mark>로 감싸지 않는다 — 새 디자인은 글자 단위
// 하이라이트를 쓰지 않고 문단 블록 전체를 틴트한다). 못 찾으면 location 헤딩으로 폴백한다.
function findAnchorElement(loc: SuggestionLocation): HTMLElement | null {
  // 빈 text(정보 누락처럼 애초에 원문에 없는 걸 지적하는 위치)로 정규식을 돌리면 빈 문자열이
  // 본문 맨 앞에서 항상 "매치"돼버려 엉뚱한 문단이 앵커로 잡힌다 — 이 경우 텍스트 매칭을 아예
  // 건너뛰고 곧장 헤딩 폴백으로 간다.
  if (!loc.text) return findHeadingAnchor(loc.location)

  const { fullText, spans } = collectTextSpans()
  const match = buildLooseTextRegex(loc.text).exec(fullText)
  if (match) {
    const matchStart = match.index
    const containingSpan = spans.find((span) => matchStart >= span.start && matchStart < span.end)
    const block = containingSpan?.node.parentElement?.closest<HTMLElement>(BLOCK_SELECTOR)
    if (block) return block
  }
  logFramingMatchFailure(fullText, loc.text)
  return findHeadingAnchor(loc.location)
}

// scrollIntoView는 실제 컨플루언스처럼 중첩된 스크롤 컨테이너가 있는 페이지에서 엉뚱한 조상을
// 스크롤하거나(호스트 페이지 레이아웃을 건드림) 전혀 안 움직이는 것처럼 보일 수 있다(디자인
// 핸드오프도 이걸 피하라고 명시했었다) — 대신 실제로 스크롤 가능한 조상을 직접 찾아 그 컨테이너의
// scrollTop을 계산해서 옮긴다.
function findScrollableAncestor(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement
  while (node && node !== document.body && node !== document.documentElement) {
    const overflowY = getComputedStyle(node).overflowY
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node
    }
    node = node.parentElement
  }
  return null
}

function scrollElementToCenter(el: HTMLElement): void {
  const container = findScrollableAncestor(el)
  const elRect = el.getBoundingClientRect()

  if (container) {
    const containerRect = container.getBoundingClientRect()
    const offset = elRect.top - containerRect.top - (containerRect.height / 2 - elRect.height / 2)
    container.scrollTo({ top: container.scrollTop + offset, behavior: 'smooth' })
    return
  }

  const targetY = window.scrollY + elRect.top - (window.innerHeight / 2 - elRect.height / 2)
  window.scrollTo({ top: targetY, behavior: 'smooth' })
}

// current 문단 하나(플로팅 저장/취소 박스를 앵커링하고, "원래 문제 문구가 남아있는지" 등 검증의
// 기준이 되는 위치) — editableElements 중 하나를 가리킨다.
let editingEl: HTMLElement | null = null
// 지금 활성화된 제안 동안 틴트/dim 클래스를 붙이고 contentEditable='true'로 열어둔 문서 내
// 모든 블록 — 문서 전체가 편집 가능하므로(2026-08-30) current 하나만이 아니라 여기 담긴 전부가
// 클래스 제거/저장/취소/정리 대상이다.
let editableElements: HTMLElement[] = []
let editActionsEl: HTMLElement | null = null
let editRepositionRafId: number | null = null

// position:fixed 기준이라 스크롤 오프셋을 더하면 안 된다 — viewport 좌표 그대로 쓴다. 예전 AI 제안
// 툴팁의 포지셔닝 로직과 동일(같은 이유로 fixed를 씀: 컨플루언스 조상 엘리먼트에 걸린
// transform/filter의 영향을 안 받으려고).
function positionEditActions(): void {
  if (!editActionsEl || !editingEl) return
  const rect = editingEl.getBoundingClientRect()
  editActionsEl.style.top = `${rect.bottom + 6}px`
  editActionsEl.style.left = `${rect.left}px`
}

// currentEl.scrollIntoView({behavior:'smooth'})가 끝나기 전에 위치를 한 번만 계산하면 스크롤
// 애니메이션이 끝난 뒤 엉뚱한 곳에 떠 있게 된다(예전 툴팁에서 겪은 것과 같은 문제) — 열리고 나서
// 한동안 매 프레임 다시 계산해 최종적으로는 항상 실제 위치에 맞게 만든다.
function startEditActionsReposition(durationMs: number): void {
  if (editRepositionRafId !== null) cancelAnimationFrame(editRepositionRafId)
  const deadline = performance.now() + durationMs
  const tick = () => {
    if (!editActionsEl || !editingEl) {
      editRepositionRafId = null
      return
    }
    positionEditActions()
    editRepositionRafId = performance.now() < deadline ? requestAnimationFrame(tick) : null
  }
  editRepositionRafId = requestAnimationFrame(tick)
}

function hideEditActions(): void {
  editActionsEl?.remove()
  editActionsEl = null
  window.removeEventListener('scroll', positionEditActions, true)
  window.removeEventListener('resize', positionEditActions)
  if (editRepositionRafId !== null) {
    cancelAnimationFrame(editRepositionRafId)
    editRepositionRafId = null
  }
}

// current 문단 옆에 "취소"/"저장" 플로팅 박스를 띄운다 — 실제 DOM 형제로 끼워 넣지 않고(표/리스트
// 구조가 깨질 수 있어서) 예전 AI 제안 툴팁처럼 document.documentElement에 별도로 붙인다. 문서
// 전체가 이미 contentEditable이라(setActiveSuggestion 참고) 클릭하면 브라우저 기본 동작으로
// 캐럿이 정확히 놓인다 — 예전엔 클릭 "전"엔 편집 불가 상태였어서 캐럿을 수동으로 놓는
// caretRangeFromPoint 트릭이 필요했지만, 이제 필요 없다.
function showEditActions(current: EditableSuggestionLocation): void {
  hideEditActions()
  if (!editingEl) return
  const anchor = editingEl

  const box = document.createElement('div')
  box.className = EDIT_ACTIONS_CLASS
  box.innerHTML =
    `<div class="${EDIT_ACTIONS_CLASS}-notice"></div>` +
    `<div class="${EDIT_ACTIONS_CLASS}-row">` +
    `<button type="button" class="${EDIT_ACTIONS_CLASS}-cancel">취소</button>` +
    `<button type="button" class="${EDIT_ACTIONS_CLASS}-save">저장</button>` +
    `</div>`
  document.documentElement.appendChild(box)
  editActionsEl = box
  positionEditActions()
  window.addEventListener('scroll', positionEditActions, true)
  window.addEventListener('resize', positionEditActions)
  startEditActionsReposition(800)

  const noticeEl = box.querySelector<HTMLElement>(`.${EDIT_ACTIONS_CLASS}-notice`)
  const saveBtn = box.querySelector<HTMLButtonElement>(`.${EDIT_ACTIONS_CLASS}-save`)
  const cancelBtn = box.querySelector<HTMLButtonElement>(`.${EDIT_ACTIONS_CLASS}-cancel`)
  if (!noticeEl || !saveBtn || !cancelBtn) return

  // 처음 누르면: (1) 원래 문제 문구가 아직 남아있는지(로컬, 즉시) → (2) related가 아니면 이 수정이
  // 검증기준을 실질적으로 해결하는지(백엔드 LLM 판단)까지 확인한다. 걸리면 저장하지 않고 경고만
  // 띄운 채 리턴 — "그래도 저장"을 한 번 더 눌러야 그대로 반영된다. 패널의 기존 편집 흐름
  // (SuggestionDirectionCard)과 동일한 2단계 확인 UX를 문서 쪽에도 그대로 옮긴 것.
  let warningAcknowledged = false

  // 취소는 current 문단만이 아니라, 이 제안이 활성화된 동안 편집 가능했던 문서 전체 블록을
  // 전부 원래 스냅샷으로 되돌린다 — 문서 전체가 편집 가능해진 뒤로는 사용자가 current 밖의
  // 다른 문단도 고쳤을 수 있기 때문(2026-08-30).
  cancelBtn.addEventListener('click', () => {
    for (const el of editableElements) {
      if (el.dataset.sunnicOriginalText !== undefined) el.textContent = el.dataset.sunnicOriginalText
    }
    warningAcknowledged = false
    noticeEl.textContent = ''
    saveBtn.textContent = '저장'
    hideEditActions()
  })

  const handleSaveClick = async () => {
    const oldText = anchor.dataset.sunnicOriginalText ?? ''
    const newText = anchor.textContent ?? ''
    // 문서 전체가 편집 가능해지면서(2026-08-30) "이 문단은 그대로 두고 다른 문단만 고쳤다"가
    // 정상적인 사용법이 됐다 — current를 안 건드렸으면 isIssueLikelyResolved(oldText, oldText)가
    // 항상 false(자기 자신을 포함하니까)를 돌려줘서 매번 "문제 문구가 남아있다" 경고가 뜨고
    // "그래도 저장"을 한 번 더 눌러야 하는 게 불편함을 넘어 실사용 버그로 보고됨(다른 문단만
    // 고쳤는데 그 경고를 못 보고 넘어가면 저장 자체가 하나도 안 나감). current를 실제로 안
    // 건드렸으면 이 검증들(문구 잔존 확인 + AI 유사도 확인) 자체를 건너뛴다 — 둘 다 current의
    // 수정이 "그 이슈를 해결했는지"를 판단하는 목적이라, current가 그대로면 판단할 대상이 없다.
    if (!warningAcknowledged && oldText !== newText) {
      // 여기서 "문제였던 문구"는 oldText(문단 전체 스냅샷)가 아니라 current.text(AI가 지목한
      // 인용구, 문단 전체가 아니라 그 안의 한 구절일 수 있음)여야 한다 — 문단 전체를 넣으면 그
      // 인용구를 안 건드린 다른 부분만 고쳐도 "해결됨"으로 잘못 통과된다.
      if (!isIssueLikelyResolved(current.text, newText)) {
        noticeEl.textContent = '원래 문제였던 표현이 아직 남아있어요. 정말 해결됐으면 한 번 더 눌러주세요.'
        warningAcknowledged = true
        saveBtn.textContent = '그래도 저장'
        return
      }

      if (current.suggestion !== null) {
        saveBtn.disabled = true
        saveBtn.textContent = '확인 중...'
        try {
          const result = await api.checkEditSimilarity({
            originalText: current.text,
            criteria: current.criteria,
            reason: current.reason,
            suggestion: current.suggestion,
            editedText: newText,
          })
          if (!result.addresses_issue) {
            noticeEl.textContent = `${result.reason || 'AI 제안과 다소 달라요.'} 의도한 수정이 맞으면 한 번 더 눌러주세요.`
            warningAcknowledged = true
            saveBtn.disabled = false
            saveBtn.textContent = '그래도 저장'
            return
          }
        } catch {
          // 검사 실패는 무시하고 저장은 계속 진행한다.
        }
      }
    }

    saveBtn.disabled = true
    cancelBtn.disabled = true
    saveBtn.textContent = '저장 중...'
    noticeEl.textContent = ''

    // current 하나만이 아니라, 이 제안이 떠 있는 동안 사용자가 실제로 고친 모든 블록을 찾아
    // 한 번의 저장 요청에 같이 담는다(문서 전체 편집 허용, 2026-08-30). current는 항상 맨
    // 앞에 둬서, 혹시 같은 문구가 여러 블록에 겹치더라도 의도한 위치부터 먼저 치환되게 한다.
    const changedElements = editableElements.filter(
      (el) => el !== anchor && (el.dataset.sunnicOriginalText ?? '') !== (el.textContent ?? ''),
    )
    const edits = [
      { oldText, newText },
      ...changedElements.map((el) => ({ oldText: el.dataset.sunnicOriginalText ?? '', newText: el.textContent ?? '' })),
    ]

    const result = await applyIssueEdits(edits)
    if (!result.ok) {
      noticeEl.textContent = result.error
      saveBtn.disabled = false
      cancelBtn.disabled = false
      saveBtn.textContent = '저장'
      warningAcknowledged = false
      return
    }

    anchor.dataset.sunnicOriginalText = newText
    for (const el of changedElements) el.dataset.sunnicOriginalText = el.textContent ?? ''
    hideEditActions()
    chrome.runtime.sendMessage<SuggestionEditSavedMessage>({ type: 'SUGGESTION_EDIT_SAVED', newText }).catch(() => {
      // 사이드패널이 닫혀있으면 받는 쪽이 없어도 저장 자체는 이미 성공한 것이니 무시한다.
    })
  }

  saveBtn.addEventListener('click', () => void handleSaveClick())
}

export function clearActiveSuggestion(): void {
  for (const el of editableElements) {
    el.classList.remove(CURRENT_CLASS, RELATED_CLASS, DONE_CLASS, DIM_CLASS)
    el.contentEditable = 'false'
    delete el.dataset.sunnicOriginalText
  }
  editableElements = []
  editingEl = null
  hideEditActions()
}

// 지금 작업 중인 제안 하나를 문서에 반영한다 — 현재 위치(실선 틴트, 클릭해서 바로 편집 가능),
// 연관 위치(점선 틴트, 읽기 전용), 이미 완료된 위치들(초록 체크)만 도드라져 보이게 하고 나머지
// 모든 문단은 흐리게(dim) 만든다.
// 반환값은 current 위치의 앵커를 실제로 찾아 틴트/스크롤까지 했는지 여부 — 내비게이터(‹›)로
// 관련 위치를 오갈 때 매칭이 조용히 실패하면 "버튼을 눌러도 아무 반응이 없다"로 보이던 문제라,
// 호출부(useSuggestionOverlaySync)가 실패를 알아채고 최소한 콘솔에라도 남길 수 있게 한다.
export function setActiveSuggestion(payload: {
  current: EditableSuggestionLocation
  related: SuggestionLocation | null
  doneLocations: SuggestionLocation[]
}): boolean {
  ensureStyleInjected()
  clearActiveSuggestion()

  const currentEl = findAnchorElement(payload.current)
  const relatedEl = payload.related ? findAnchorElement(payload.related) : null
  const doneEls = payload.doneLocations
    .map((loc) => findAnchorElement(loc))
    .filter((el): el is HTMLElement => el !== null)

  const highlighted = new Set<HTMLElement>()

  if (currentEl) {
    currentEl.classList.add(CURRENT_CLASS)
    highlighted.add(currentEl)
    editingEl = currentEl
    scrollElementToCenter(currentEl)
  } else {
    console.warn('[SunniC] current 위치 앵커를 찾지 못해 틴트/스크롤을 건너뜀:', {
      location: payload.current.location,
      text: payload.current.text.slice(0, 30),
    })
  }

  if (relatedEl && relatedEl !== currentEl) {
    relatedEl.classList.add(RELATED_CLASS)
    highlighted.add(relatedEl)
  }

  for (const el of doneEls) {
    if (highlighted.has(el)) continue
    el.classList.add(DONE_CLASS)
    highlighted.add(el)
  }

  // 나머지 문단은 전부 흐리게 — 지금 작업 중인/완료된 위치만 눈에 띄게 한다("글자 단위 하이라이트는
  // 쓰지 않는다"는 디자인 스펙에 따라 dim이 유일한 "그 외" 처리 방식이다). 표시 여부와 무관하게
  // 문서 전체를 편집 가능하게 열어둔다 — 표시된 위치만 고칠 수 있게 막아둔 게 오히려 불편하다는
  // 피드백(2026-08-30)으로, dim된 문단도 자유롭게 클릭해서 고칠 수 있다.
  //
  // dataset.sunnicOriginalText는 모든 블록에 대해 "지금 보이는 문단 전체 텍스트"(el.textContent)
  // 를 스냅샷으로 쓴다 — current/related도 예외가 아니다. payload.current.text/related.text는
  // AI가 지목한 인용구(문단 전체가 아니라 그 안의 한 구절일 수 있음)라 여기 쓰면 "사용자가 이
  // 문단을 건드렸는지"를 판단할 수 없다(인용구 ≠ 문단 전체라서 손도 안 댔는데 항상 달라 보임 —
  // 실사용 버그로 확인됨, 2026-08-30). 문단 전체 스냅샷으로 통일하면 (a) 변경 여부 판단이 모든
  // 블록에서 동일한 기준으로 일관되고, (b) 저장 시 storage HTML 치환도 "인용구 한 조각을 문단
  // 전체로 교체"(주변 문맥이 중복 삽입되는 버그)가 아니라 "문단 전체를 문단 전체로" 치환하게
  // 되어 더 안전하다. 인용구 자체(payload.current.text)는 "그 문제 문구가 아직 남아있는지"
  // 검증(isIssueLikelyResolved)에서만 별도로 쓴다 — handleSaveClick이 closure로 참조.
  for (const el of document.querySelectorAll<HTMLElement>(BLOCK_SELECTOR)) {
    if (isInsideOverlayNode(el)) continue
    if (!highlighted.has(el)) el.classList.add(DIM_CLASS)
    el.contentEditable = 'true'
    el.dataset.sunnicOriginalText = el.textContent ?? ''
    editableElements.push(el)
  }

  // current를 찾았을 때만 저장/취소 박스를 띄운다 — 문서 전체가 이미 편집 가능한 상태이므로
  // (위 루프) 클릭해서 "편집 모드로 들어가야" 뜨는 게 아니라 이 제안이 활성화된 순간부터 항상
  // 떠 있다.
  if (currentEl) showEditActions(payload.current)

  return currentEl !== null
}

// 활성 제안 개념이 없는 화면(넘버링 하모나이징 등)에서 쓰는 가벼운 버전 — 지속되는 틴트/마커 없이
// 스크롤만 하고 잠깐 배경을 반짝여 위치를 알려준다.
export function scrollToLocation(loc: SuggestionLocation): boolean {
  ensureStyleInjected()
  const el = findAnchorElement(loc)
  if (!el) return false
  scrollElementToCenter(el)
  el.classList.add(FLASH_CLASS)
  window.setTimeout(() => el.classList.remove(FLASH_CLASS), 1200)
  return true
}

// 페이지를 새로고침한 직후엔 이 배지 요청이 컨플루언스 자신의 SPA가 h1을 렌더링하기도 전에
// 도착할 수 있다 — 그러면 h1을 못 찾아 조용히 아무 것도 안 하고 끝나버린다("배지가 백엔드엔
// 통과로 기록돼 있는데 화면엔 안 뜬다"는 실사용 보고로 확인됨, 2026-08-30). h1이 나타날 때까지
// 짧게 재시도한다.
const _BADGE_MAX_RETRIES = 10
const _BADGE_RETRY_DELAY_MS = 300
let badgeRetryTimeout: ReturnType<typeof setTimeout> | null = null
// SHOW_QA_PASSED_BADGE는 여러 곳에서(문서 감지 훅, 요약 화면, 넘버링 화면) 켜질 수 있고, SPA가
// h1을 다시 그리는 사이 재시도 타이머가 겹치면 이미 큐에 들어간 stale 콜백이 배지를 한 번 더
// 붙여 제목에 "✓ QA 통과"가 여러 개 쌓였다(실사용 보고). 세대 토큰으로 지난 재시도 체인을
// 무효화하고, 실제 append 직전에 이미 배지가 있으면 건너뛴다.
let badgeGeneration = 0

function cancelBadgeRetry(): void {
  badgeGeneration += 1
  if (badgeRetryTimeout !== null) {
    clearTimeout(badgeRetryTimeout)
    badgeRetryTimeout = null
  }
}

function attemptShowBadge(retriesLeft: number, generation: number): void {
  if (generation !== badgeGeneration) return // 더 최근의 show/clear에 의해 밀려난 체인
  if (document.querySelector(`.${QA_BADGE_CLASS}`)) return // 이미 붙어 있음
  const h1 = document.querySelector('h1')
  if (!h1) {
    if (retriesLeft <= 0) return
    badgeRetryTimeout = setTimeout(() => attemptShowBadge(retriesLeft - 1, generation), _BADGE_RETRY_DELAY_MS)
    return
  }
  const badge = document.createElement('span')
  badge.className = QA_BADGE_CLASS
  badge.textContent = '✓ QA 통과'
  h1.appendChild(badge)
}

export function showQaPassedBadge(): void {
  ensureStyleInjected()
  clearQaPassedBadge()
  attemptShowBadge(_BADGE_MAX_RETRIES, badgeGeneration)
}

export function clearQaPassedBadge(): void {
  cancelBadgeRetry()
  document.querySelectorAll(`.${QA_BADGE_CLASS}`).forEach((el) => el.remove())
}

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

export interface EditPair {
  oldText: string
  newText: string
}

// pageId가 가리키는 페이지의 body.storage에서 edits를 순서대로 문자열 치환한 뒤 한 번만 PUT으로
// 저장한다. 문서 전체가 편집 가능해지면서(2026-08-30) 한 번의 저장에 여러 블록이 걸릴 수 있어
// GET/PUT을 한 번씩만 하고 그 사이에 치환을 전부 누적한다 — 블록마다 왕복하면 버전 충돌 위험도
// 커지고 느려진다. 한 pair라도 매칭에 실패하면 그 자리에서 즉시 중단하고 실패를 반환한다 — 이미
// 성공한 치환까지 포함해서 부분 저장해버리면 사용자가 의도한 것과 다른 어중간한 상태로 PUT될
// 수 있다.
async function replaceAllAndSave(pageId: string, edits: EditPair[]): Promise<ApplyResult> {
  const getRes = await fetch(`${location.origin}/wiki/rest/api/content/${pageId}?expand=body.storage,version`, {
    credentials: 'include',
  })
  if (!getRes.ok) return { ok: false, error: `문서를 불러오지 못했습니다 (${getRes.status})` }

  const data = (await getRes.json()) as {
    title: string
    version: { number: number }
    body: { storage: { value: string } }
  }
  let html = data.body.storage.value
  for (const { oldText, newText } of edits) {
    const updatedHtml = replaceInStorageHtml(html, oldText, newText)
    if (updatedHtml === null) {
      logStorageMatchFailure(html, oldText)
      return { ok: false, error: '원문에서 해당 문구를 찾지 못했습니다.' }
    }
    html = updatedHtml
  }

  const putRes = await fetch(`${location.origin}/wiki/rest/api/content/${pageId}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Atlassian-Token': 'no-check' },
    body: JSON.stringify({
      version: { number: data.version.number + 1 },
      title: data.title,
      type: 'page',
      body: { storage: { value: html, representation: 'storage' } },
    }),
  })
  if (!putRes.ok) return { ok: false, error: `저장에 실패했습니다 (${putRes.status})` }
  return { ok: true }
}

// QA 리뷰 세션당 복제본 1개 — 원본은 절대 쓰지 않고, 첫 적용에서 이 복제본을 만들어 이후 모든 적용을
// 여기에 누적한다. 페이지를 새로고침하면 초기화되고 다음 적용에서 새 복제본이 다시 만들어진다.
// originalPageId는 이 복제본이 "어느 원본에서 나왔는지" — Confluence는 SPA라 탭 내 페이지 이동 시
// content script가 재주입되지 않으므로, 다른 페이지로 옮겨간 뒤엔 이 세션이 스테일해진다. 그때
// 이전 복제본을 그대로 재사용하면 엉뚱한 페이지에 저장/대조하게 되어 originalPageId로 걸러낸다.
let duplicateSession: { pageId: string; title: string; originalPageId: string } | null = null

// 테스트 전용 — 모듈이 파일 내 여러 테스트에 걸쳐 싱글턴으로 유지되므로, 세션이 없는 상태(첫 적용)를
// 매 테스트마다 재현하려면 이걸로 초기화해야 한다.
export function __resetDuplicateSessionForTests(): void {
  duplicateSession = null
}

// 사이드패널이 "지금 리뷰 중 수정이 실제로 쌓이고 있는 페이지"를 알아야 할 때(예: 넘버링 재검증 전
// 최신 본문을 다시 읽어올 때) 쓴다 — 아직 한 건도 적용 안 했거나, 세션이 다른 원본 페이지 것이면 null.
export function getActiveDuplicatePageId(originalPageId: string | null): string | null {
  if (!duplicateSession) return null
  if (originalPageId !== null && duplicateSession.originalPageId !== originalPageId) return null
  return duplicateSession.pageId
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
  // 현재 보고 있는 원본에서 만든 세션일 때만 재사용한다 — 다른 페이지 것이면 스테일이므로 새로 만든다.
  if (duplicateSession && duplicateSession.originalPageId === originalPageId) {
    return { ok: true, pageId: duplicateSession.pageId }
  }

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
  duplicateSession = { pageId: created.id, title, originalPageId }
  return { ok: true, pageId: created.id }
}

// 문서 전체가 편집 가능해지면서(2026-08-30) 한 번의 저장이 여러 블록을 동시에 치환해야 할 수
// 있다 — 실제 치환/저장은 이 복수형이 전담하고, 단일 치환은 그 특수 케이스(길이 1짜리 배열)로
// 구현한다. 두 함수 모두 이 파일 안에서만 직접 호출되는 일반 함수다(패널 쪽에서 이 메시지를
// 보내는 코드는 없다 — chrome.runtime 메시지가 아니라 여기 handleSaveClick이 직접 호출).
// backend qa_engine/numbering_validation.py의 _NUMBER_RE, extension/src/utils/locationLabel.ts의
// LEADING_NUMBER_RE와 동일한 조건 — 헤딩 텍스트 맨 앞의 "번호" 세그먼트만 골라낸다.
const LEADING_NUMBER_RE = /^\s*\d+(?:[-.]\d+)*[.\s]+/

// 넘버링 이슈는 (AI 이슈가 아니라 애초에 mark 하이라이트 대상이 아니므로) 저장은 복제본에
// 성공해도 지금 보고 있는 원본 화면엔 아무 변화가 없어 "반영이 안 됐다"는 오인 보고로 이어졌다
// (실사용 확인됨). oldText/newText는 헤딩 텍스트 전체지만 실제로 다른 부분은 맨 앞 번호뿐이므로
// (백엔드 _replace_number와 동일 전제), 헤딩을 통째로 갈아치우지 않고 그 헤딩의 첫 텍스트 노드에서
// 번호 접두어만 치환한다 — 강조/링크 등 인라인 마크업이 번호 뒤에 있어도(예: "4. 해결
// <strong>방안</strong>") 안전하다. 조건이 안 맞으면(번호를 못 뽑았거나, 헤딩을 못 찾았거나,
// 첫 텍스트 노드가 그 번호로 시작하지 않으면) 조용히 포기한다 — 실제 저장(복제본)엔 영향 없는
// 순수 로컬 표시라 실패해도 안전하다.
function overwriteHeadingTextInDom(oldText: string, newText: string): void {
  const oldNumber = LEADING_NUMBER_RE.exec(oldText)?.[0]
  const newNumber = LEADING_NUMBER_RE.exec(newText)?.[0]
  if (!oldNumber || !newNumber) return

  const target = normalizeHeadingText(oldText)
  const heading = Array.from(document.querySelectorAll<HTMLElement>('h2, h3, h4, h5, h6')).find(
    (h) => !isInsideOverlayNode(h) && normalizeHeadingText(h.textContent ?? '') === target,
  )
  if (!heading) return

  const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT)
  const first = walker.nextNode() as Text | null
  if (!first) return

  const prefixMatch = new RegExp(`^${buildLooseTextRegex(oldNumber).source}`).exec(first.data)
  if (!prefixMatch) return
  first.data = newNumber + first.data.slice(prefixMatch[0].length)
}

export async function applyIssueEdits(edits: EditPair[]): Promise<ApplyResult> {
  if (edits.length === 0) return { ok: true }

  const originalPageId = extractPageId(location.href)
  if (!originalPageId) return { ok: false, error: '컨플루언스 문서 URL이 아니라 복제본을 만들 수 없습니다.' }

  const session = await ensureDuplicateSession(originalPageId)
  if (!session.ok) return session

  const result = await replaceAllAndSave(session.pageId, edits)
  if (!result.ok) return result

  // 저장 자체는 원본이 아니라 복제본에 쌓이지만, 넘버링 하모나이징(번호만 바뀌는 편집)은 지금 보고
  // 있는 원본 화면에도 즉시 반영해야 "반영이 안 됐다"는 오인이 없다 — 위 overwriteHeadingTextInDom
  // 참고. 번호가 아닌 일반 편집은 이 함수가 조용히 no-op한다.
  for (const { oldText, newText } of edits) overwriteHeadingTextInDom(oldText, newText)
  return result
}

export async function applyIssueEdit(_issueId: string, oldText: string, newText: string): Promise<ApplyResult> {
  return applyIssueEdits([{ oldText, newText }])
}

const COMMIT_HEADING_SELECTOR = 'h2, h3, h4, h5, h6'

function readHeadingTexts(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll<HTMLElement>(COMMIT_HEADING_SELECTOR))
    .filter((el) => !isInsideOverlayNode(el))
    .map((el) => normalizeHeadingText(el.textContent ?? ''))
    .filter(Boolean)
}

// "QA 완료" 직전 호출 — 좌측 문서 뷰(라이브 DOM)의 h2~h6 헤딩을 저장본(복제본 또는 원본)과
// 위치(순서) 기준으로 대조해, 제안 저장에 딸려가지 못한 인라인 헤딩 편집을 복제본에 반영한다.
// 그래야 이어지는 넘버링 검증이 옛 저장본이 아니라 지금 화면 상태를 본다. 헤딩 개수가 바뀐 경우
// (삽입/삭제)는 위치 매칭이 깨지므로 이번엔 건너뛴다.
export async function commitDocumentEdits(): Promise<CommitDocumentEditsResponse> {
  const originalPageId = extractPageId(location.href)
  if (!originalPageId) return { ok: false, error: '컨플루언스 문서 URL이 아닙니다.' }

  const targetPageId = getActiveDuplicatePageId(originalPageId) ?? originalPageId

  let storageHtml: string
  try {
    const res = await fetch(`${location.origin}/wiki/rest/api/content/${targetPageId}?expand=body.storage`, {
      credentials: 'include',
    })
    if (!res.ok) return { ok: false, error: `저장본을 불러오지 못했습니다 (${res.status})` }
    storageHtml = ((await res.json()) as { body: { storage: { value: string } } }).body.storage.value
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }

  const stored = readHeadingTexts(new DOMParser().parseFromString(storageHtml, 'text/html'))
  const live = readHeadingTexts(document)

  // 헤딩 개수가 다르면 stored[i] ↔ live[i] 대응 자체가 성립하지 않는다 — 위치 매칭 금지.
  if (stored.length !== live.length) return { ok: true, reconciled: 0, skippedCountMismatch: true }

  const { fullText } = decodeStorageHtmlText(storageHtml)
  const edits: EditPair[] = []
  for (let i = 0; i < stored.length; i += 1) {
    if (stored[i] === live[i]) continue
    // 번호 접두어 이외(제목 본문)가 달라졌으면 이번 범위 밖 — 넘버링만 다루고, 사용자가 고친
    // 제목까지 여기서 건드리지 않는다.
    if (stored[i].replace(LEADING_NUMBER_RE, '') !== live[i].replace(LEADING_NUMBER_RE, '')) continue
    // replaceInStorageHtml은 문서 전체 텍스트의 "첫 매치"만 치환한다 — 같은 문구가 본문 산문에
    // 먼저 나오거나 동일 헤딩이 2개면 엉뚱한 곳을 고친다. 전역 매치가 정확히 1건일 때만 자동
    // reconcile하고, 아니면 넘버링 확인 화면에서 사용자가 판단하게 둔다.
    // (buildLooseTextRegex는 공백만 느슨화하고 숫자·마침표는 literal이라 "3. 개요"가 "2. 개요"에
    //  매칭될 일은 없다.)
    const occurrences = fullText.match(new RegExp(buildLooseTextRegex(stored[i]).source, 'g'))
    if (!occurrences || occurrences.length !== 1) continue
    edits.push({ oldText: stored[i], newText: live[i] })
  }

  if (edits.length === 0) return { ok: true, reconciled: 0 }

  const session = await ensureDuplicateSession(originalPageId)
  if (!session.ok) return session

  const result = await replaceAllAndSave(session.pageId, edits)
  if (!result.ok) return result
  return { ok: true, reconciled: edits.length }
}

type OverlayRequest =
  | SetActiveSuggestionRequest
  | ClearActiveSuggestionRequest
  | ScrollToLocationRequest
  | ShowQaPassedBadgeRequest
  | ClearQaPassedBadgeRequest
  | GetActiveDuplicatePageRequest
  | ApplyIssueEditRequest
  | CommitDocumentEditsRequest
type OverlayResponse =
  | SetActiveSuggestionResponse
  | ClearActiveSuggestionResponse
  | ScrollToLocationResponse
  | QaPassedBadgeResponse
  | GetActiveDuplicatePageResponse
  | ApplyIssueEditResponse
  | CommitDocumentEditsResponse

chrome.runtime.onMessage.addListener(
  (message: OverlayRequest, _sender, sendResponse: (response: OverlayResponse) => void) => {
    if (message.type === 'SET_ACTIVE_SUGGESTION') {
      sendResponse({ ok: setActiveSuggestion(message) })
      return true
    }
    if (message.type === 'CLEAR_ACTIVE_SUGGESTION') {
      clearActiveSuggestion()
      sendResponse({ ok: true })
      return true
    }
    if (message.type === 'SCROLL_TO_LOCATION') {
      sendResponse({ ok: scrollToLocation(message.location) })
      return true
    }
    if (message.type === 'SHOW_QA_PASSED_BADGE') {
      showQaPassedBadge()
      sendResponse({ ok: true })
      return true
    }
    if (message.type === 'CLEAR_QA_PASSED_BADGE') {
      clearQaPassedBadge()
      sendResponse({ ok: true })
      return true
    }
    if (message.type === 'APPLY_ISSUE_EDIT') {
      void applyIssueEdit(message.issueId, message.oldText, message.newText).then(sendResponse)
      return true
    }
    if (message.type === 'GET_ACTIVE_DUPLICATE_PAGE') {
      const originalPageId = extractPageId(location.href)
      sendResponse({ ok: true, pageId: getActiveDuplicatePageId(originalPageId), originalPageId })
      return true
    }
    if (message.type === 'COMMIT_DOCUMENT_EDITS') {
      void commitDocumentEdits().then(sendResponse)
      return true
    }
    return undefined
  },
)
