import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetDuplicateSessionForTests,
  applyIssueEdit,
  clearActiveSuggestion,
  clearQaPassedBadge,
  commitDocumentEdits,
  formatKstTimestamp,
  getActiveDuplicatePageId,
  scrollToLocation,
  setActiveSuggestion,
  showQaPassedBadge,
} from './issueOverlay'
import type { EditableSuggestionLocation, SuggestionLocation } from './messages'

const CURRENT: EditableSuggestionLocation = {
  text: '3사만 지원, 페이코 미지원',
  location: '결제 수단',
  criteria: '용어 및 단어의 일관성',
  reason: '테스트용 이유',
  suggestion: '4사만 지원, 페이코 미지원',
}
const RELATED: SuggestionLocation = { text: '결제 실패 시 안내 문구 없음', location: '결제 실패 안내' }

// current로 넘길 때 편집 관련 필드가 중요하지 않은(하이라이트/폴백/dim 로직만 확인하는) 테스트용 헬퍼.
function editable(loc: SuggestionLocation): EditableSuggestionLocation {
  return { ...loc, criteria: '', reason: '', suggestion: null }
}

// 문서 전체가 setActiveSuggestion 시점부터 이미 contentEditable이라(2026-08-30) 이 클릭 자체가
// 더 이상 어떤 상태 전환도 일으키지 않는다 — 실제 브라우저에서 사용자가 클릭해 포커스를 옮기는
// 걸 흉내내는 용도로만 남겨둔다.
function clickInto(el: HTMLElement): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 5, clientY: 5 }))
}

const ORIGINAL_PAGE_ID = '482910'
const DUPLICATE_PAGE_ID = '900001'
// CURRENT.text("3사만 지원, 페이코 미지원")는 이 문단 전체가 아니라 AI가 지목한 한 구절이다 —
// dataset.sunnicOriginalText는 이제 문단 전체 스냅샷을 담으므로(2026-08-30), 그걸 검증하는
// 테스트는 CURRENT.text가 아니라 이 상수와 비교해야 한다.
const FIRST_PARAGRAPH_FULL_TEXT = '간편결제(카카오페이, 네이버페이, 토스) 3사만 지원, 페이코 미지원 안내.'
const PAGE_HTML = `<p>${FIRST_PARAGRAPH_FULL_TEXT}</p><p>결제 실패 시 안내 문구 없음</p>`

function stubConfluenceFetch(overrides?: {
  duplicateBody?: string
  createOk?: boolean
  putOk?: boolean
  similarityOk?: boolean
  similarityReason?: string
}): ReturnType<typeof vi.fn> {
  const createOk = overrides?.createOk ?? true
  const putOk = overrides?.putOk ?? true
  const duplicateBody = overrides?.duplicateBody ?? PAGE_HTML
  const similarityOk = overrides?.similarityOk ?? true
  const similarityReason = overrides?.similarityReason ?? ''

  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/issues/similarity-check')) {
      return new Response(JSON.stringify({ addresses_issue: similarityOk, reason: similarityReason }), { status: 200 })
    }
    if (init?.method === 'PUT') {
      return new Response(JSON.stringify({ ok: true }), { status: putOk ? 200 : 500 })
    }
    if (init?.method === 'POST') {
      return new Response(JSON.stringify({ id: DUPLICATE_PAGE_ID, title: 'duplicate' }), { status: createOk ? 200 : 500 })
    }
    if (url.includes(`/wiki/rest/api/content/${ORIGINAL_PAGE_ID}`)) {
      return new Response(
        JSON.stringify({ title: 'PRD', space: { key: 'MFS' }, body: { storage: { value: PAGE_HTML } } }),
        { status: 200 },
      )
    }
    return new Response(
      JSON.stringify({ title: 'duplicate', version: { number: 1 }, body: { storage: { value: duplicateBody } } }),
      { status: 200 },
    )
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

// happy-dom exposes a window.happyDOM.setURL() test helper, but the standard lib.dom types (what tsc
// checks against) don't know about it — happy-dom's own types aren't wired into this project's tsconfig.
interface HappyDomWindow {
  happyDOM: { setURL: (url: string) => void }
}

beforeEach(() => {
  document.body.innerHTML = `<main>${PAGE_HTML}</main>`
  ;(window as unknown as HappyDomWindow).happyDOM.setURL(`http://localhost:8000/mock-confluence/pages/${ORIGINAL_PAGE_ID}`)
  __resetDuplicateSessionForTests()
  clearActiveSuggestion()
  clearQaPassedBadge()
  // test-setup.ts 전역 chrome 스텁엔 sendMessage가 없어 이 테스트에서만 보강한다.
  chrome.runtime.sendMessage = vi.fn().mockResolvedValue(undefined)
})

describe('setActiveSuggestion', () => {
  it('tints the paragraph matching current.text and dims every other block', () => {
    setActiveSuggestion({ current: CURRENT, related: null, doneLocations: [] })

    const paragraphs = document.querySelectorAll('p')
    expect(paragraphs[0].classList.contains('sunnic-loc-current')).toBe(true)
    expect(paragraphs[1].classList.contains('sunnic-loc-dim')).toBe(true)
    expect(paragraphs[0].classList.contains('sunnic-loc-dim')).toBe(false)
  })

  it('marks the related location with a dashed style, distinct from current', () => {
    setActiveSuggestion({ current: CURRENT, related: RELATED, doneLocations: [] })

    const paragraphs = document.querySelectorAll('p')
    expect(paragraphs[0].classList.contains('sunnic-loc-current')).toBe(true)
    expect(paragraphs[1].classList.contains('sunnic-loc-related')).toBe(true)
    expect(paragraphs[1].classList.contains('sunnic-loc-dim')).toBe(false)
  })

  it('marks already-done locations instead of dimming them', () => {
    document.body.innerHTML = `<main>${PAGE_HTML}<p>세 번째 문단, 아직 안 건드림</p></main>`
    setActiveSuggestion({ current: CURRENT, related: null, doneLocations: [RELATED] })

    const paragraphs = document.querySelectorAll('p')
    expect(paragraphs[0].classList.contains('sunnic-loc-current')).toBe(true)
    expect(paragraphs[1].classList.contains('sunnic-loc-done')).toBe(true)
    expect(paragraphs[1].classList.contains('sunnic-loc-dim')).toBe(false)
    expect(paragraphs[2].classList.contains('sunnic-loc-dim')).toBe(true)
  })

  it('is editable immediately (no click needed) and remembers the original text for revert', () => {
    setActiveSuggestion({ current: CURRENT, related: null, doneLocations: [] })
    const el = document.querySelector<HTMLElement>('p')
    if (!el) throw new Error('paragraph not found')

    expect(el.contentEditable).toBe('true')
    expect(el.dataset.sunnicOriginalText).toBe(FIRST_PARAGRAPH_FULL_TEXT)
  })

  // 표시된(틴트된) 위치만 고칠 수 있게 막아둔 게 오히려 불편하다는 실사용 피드백(2026-08-30)으로
  // 문서 전체를 항상 편집 가능하게 열어둔다 — related/done은 물론 dim된 문단까지도 예외 없다.
  it('makes every block in the document editable, not just current — related/done/dim included', () => {
    document.body.innerHTML = `<main>${PAGE_HTML}<p>세 번째 문단, 아직 안 건드림</p></main>`
    setActiveSuggestion({ current: CURRENT, related: RELATED, doneLocations: [] })

    const paragraphs = document.querySelectorAll<HTMLElement>('p')
    expect(paragraphs[0].contentEditable).toBe('true') // current
    expect(paragraphs[1].contentEditable).toBe('true') // related
    expect(paragraphs[2].contentEditable).toBe('true') // dim(그 외)
  })

  it('scrolls the page so the current paragraph is centered', () => {
    const scrollSpy = vi.fn()
    window.scrollTo = scrollSpy

    setActiveSuggestion({ current: CURRENT, related: null, doneLocations: [] })

    expect(scrollSpy).toHaveBeenCalled()
    expect(scrollSpy.mock.calls[0][0]).toMatchObject({ behavior: 'smooth' })
  })

  it('falls back to the location heading when current.text has no match (e.g. missing-info issues)', () => {
    document.body.innerHTML =
      '<main><h2>6. 프로덕트 기능</h2><h3>6-1. 메인 배너 (캐러셀)</h3><p>최대 5개 슬라이드로 구성.</p></main>'
    const missing: SuggestionLocation = {
      text: '자동 슬라이드 전환 간격',
      location: '6. 프로덕트 기능 > 6-1. 메인 배너 (캐러셀)',
    }

    setActiveSuggestion({ current: editable(missing), related: null, doneLocations: [] })

    const heading = document.querySelector('h3')
    expect(heading?.classList.contains('sunnic-loc-current')).toBe(true)
  })

  it('never falls back to the page title (h1) even when location matches nothing but it', () => {
    document.body.innerHTML = '<main><h1>[DOC-001] NxEF 모바일 웹 — 홈 화면 PRD (v1.0)</h1><h2>1. 프로덕트 목적</h2></main>'
    const missing: SuggestionLocation = {
      text: '문서에 없는 문구',
      location: '[DOC-001] NxEF 모바일 웹 — 홈 화면 PRD (v1.0)',
    }

    setActiveSuggestion({ current: editable(missing), related: null, doneLocations: [] })

    expect(document.querySelector('h1')?.classList.contains('sunnic-loc-current')).toBe(false)
  })

  it('never matches an empty text (insert_range issues) against the start of the document', () => {
    document.body.innerHTML = '<main><h2>다른 제목</h2><p>첫 문단</p></main>'
    const empty: SuggestionLocation = { text: '', location: '다른 제목' }

    setActiveSuggestion({ current: editable(empty), related: null, doneLocations: [] })

    // text가 비어있으면 정규식이 본문 맨 앞에서 항상 "매치"돼버리는 걸 막아야 한다 — 곧장 헤딩
    // 폴백으로 가서 h2가 앵커가 되는지 확인.
    expect(document.querySelector('h2')?.classList.contains('sunnic-loc-current')).toBe(true)
    expect(document.querySelector('p')?.classList.contains('sunnic-loc-current')).toBe(false)
  })

  it('replaces a previously active suggestion cleanly when called again', () => {
    setActiveSuggestion({ current: CURRENT, related: null, doneLocations: [] })
    setActiveSuggestion({ current: editable(RELATED), related: null, doneLocations: [] })

    const paragraphs = document.querySelectorAll('p')
    expect(paragraphs[0].classList.contains('sunnic-loc-current')).toBe(false)
    expect(paragraphs[0].classList.contains('sunnic-loc-dim')).toBe(true)
    expect(paragraphs[1].classList.contains('sunnic-loc-current')).toBe(true)
  })
})

describe('clearActiveSuggestion', () => {
  it('removes every injected class, turns off contentEditable, and closes the edit-actions box', () => {
    setActiveSuggestion({ current: CURRENT, related: RELATED, doneLocations: [] })
    clearActiveSuggestion()

    for (const p of document.querySelectorAll<HTMLElement>('p')) {
      expect(p.className).toBe('')
    }
    // 첫 문단만 current였다(contentEditable이 켜졌었다) — clear 후 다시 꺼졌는지 확인.
    expect(document.querySelectorAll<HTMLElement>('p')[0].contentEditable).toBe('false')
    expect(document.querySelector('.sunnic-edit-actions')).toBeNull()
  })
})

describe('editing the current paragraph in place', () => {
  // 문서 전체가 이미 편집 가능하므로(2026-08-30) 클릭해서 "편집 모드로 들어가야" 뜨는 게
  // 아니라, 이 제안이 활성화된 순간(current를 찾은 직후) 바로 뜬다.
  it('shows the floating 취소/저장 box as soon as the suggestion becomes active, without needing a click', () => {
    setActiveSuggestion({ current: CURRENT, related: null, doneLocations: [] })

    const box = document.querySelector('.sunnic-edit-actions')
    expect(box).not.toBeNull()
    expect(box?.querySelector('.sunnic-edit-actions-cancel')?.textContent).toBe('취소')
    expect(box?.querySelector('.sunnic-edit-actions-save')?.textContent).toBe('저장')
  })

  // 문서 전체가 편집 가능한 상태는 이 제안이 떠 있는 내내 유지된다 — 취소는 텍스트만 원복하고
  // 박스만 닫을 뿐, contentEditable을 끄지 않는다(다른 문단도 여전히 자유롭게 고칠 수 있어야
  // 하므로, 2026-08-30).
  it('cancel reverts the text and closes the box, but keeps the document editable', () => {
    setActiveSuggestion({ current: CURRENT, related: null, doneLocations: [] })
    const el = document.querySelector<HTMLElement>('p')
    if (!el) throw new Error('paragraph not found')
    el.textContent = '아무렇게나 고친 문구'

    document.querySelector<HTMLButtonElement>('.sunnic-edit-actions-cancel')?.click()

    expect(el.textContent).toBe(FIRST_PARAGRAPH_FULL_TEXT)
    expect(el.contentEditable).toBe('true')
    expect(document.querySelector('.sunnic-edit-actions')).toBeNull()
  })

  // 저장 시 current 밖에서 사용자가 고친 다른 블록도 같이 저장돼야 한다(전체 편집 허용,
  // 2026-08-30) — 여기선 related 문단도 같이 고쳐서 한 번의 저장 요청에 두 치환이 다 담기는지
  // 확인한다.
  it('save also picks up edits made to other (non-current) blocks in the same session', async () => {
    const fetchMock = stubConfluenceFetch()
    setActiveSuggestion({ current: CURRENT, related: RELATED, doneLocations: [] })
    const paragraphs = document.querySelectorAll<HTMLElement>('p')
    paragraphs[0].textContent = '4사만 지원, 페이코 미지원'
    paragraphs[1].textContent = '결제 실패 시 재시도 버튼 안내'

    document.querySelector<HTMLButtonElement>('.sunnic-edit-actions-save')?.click()

    await vi.waitFor(() => {
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        type: 'SUGGESTION_EDIT_SAVED',
        newText: '4사만 지원, 페이코 미지원',
      })
    })
    const putCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')
    const putBody = JSON.parse((putCall?.[1] as RequestInit).body as string) as { body: { storage: { value: string } } }
    expect(putBody.body.storage.value).toContain('4사만 지원, 페이코 미지원')
    expect(putBody.body.storage.value).toContain('결제 실패 시 재시도 버튼 안내')
    // 저장 하나에 두 블록 다 담겼으니 PUT은 한 번만 나가야 한다.
    const puts = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')
    expect(puts).toHaveLength(1)
  })

  // 실사용 버그: current를 안 건드리고 다른 문단만 고쳐서 저장했더니 아무것도 반영이 안 됐다는
  // 보고(2026-08-30) — isIssueLikelyResolved(oldText, oldText)가 "자기 자신을 포함하니" 항상
  // false를 돌려줘서 매번 "그래도 저장" 확인을 한 번 더 요구했었고, 그걸 놓치면 저장 자체가
  // 안 나갔다. current를 안 건드렸을 땐 그 확인 자체를 건너뛰어야 한다.
  it('saves edits made only to a non-current block, without requiring the "그래도 저장" confirmation gate', async () => {
    const fetchMock = stubConfluenceFetch()
    setActiveSuggestion({ current: CURRENT, related: RELATED, doneLocations: [] })
    const paragraphs = document.querySelectorAll<HTMLElement>('p')
    // current(paragraphs[0])는 손대지 않는다 — related만 고친다.
    paragraphs[1].textContent = '결제 실패 시 재시도 버튼 안내'

    document.querySelector<HTMLButtonElement>('.sunnic-edit-actions-save')?.click()

    await vi.waitFor(() => {
      const putCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')
      expect(putCall).toBeDefined()
    })
    // "그래도 저장" 경고에 걸렸다면 박스가 안 닫히고 남아있었을 것이다 — 곧장 저장까지 갔다는
    // 신호로 박스가 닫혔는지 확인한다.
    expect(document.querySelector('.sunnic-edit-actions')).toBeNull()
    const putCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')
    const putBody = JSON.parse((putCall?.[1] as RequestInit).body as string) as { body: { storage: { value: string } } }
    expect(putBody.body.storage.value).toContain('결제 실패 시 재시도 버튼 안내')
  })

  it('warns when the original problem text is still present, and requires a second click to save anyway', async () => {
    const fetchMock = stubConfluenceFetch()
    setActiveSuggestion({ current: CURRENT, related: null, doneLocations: [] })
    const el = document.querySelector<HTMLElement>('p')
    if (!el) throw new Error('paragraph not found')
    clickInto(el)
    const saveBtn = document.querySelector<HTMLButtonElement>('.sunnic-edit-actions-save')
    if (!saveBtn) throw new Error('save button not found')

    // 원문을 그대로 둔 채(공백만 추가) 저장 시도 — 여전히 문제 문구를 포함하고 있다.
    el.textContent = `${CURRENT.text} `
    saveBtn.click()

    await vi.waitFor(() => expect(saveBtn.textContent).toBe('그래도 저장'))
    expect(document.querySelector('.sunnic-edit-actions-notice')?.textContent).toContain('아직 남아있어요')
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')).toBe(false)
  })

  it('saves the edit to the Confluence duplicate, notifies the panel, and closes the box (document stays editable)', async () => {
    const fetchMock = stubConfluenceFetch()
    setActiveSuggestion({ current: CURRENT, related: null, doneLocations: [] })
    const el = document.querySelector<HTMLElement>('p')
    if (!el) throw new Error('paragraph not found')
    clickInto(el)
    el.textContent = '4사만 지원, 페이코 미지원'

    document.querySelector<HTMLButtonElement>('.sunnic-edit-actions-save')?.click()

    await vi.waitFor(() => {
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        type: 'SUGGESTION_EDIT_SAVED',
        newText: '4사만 지원, 페이코 미지원',
      })
    })
    expect(el.contentEditable).toBe('true')
    expect(document.querySelector('.sunnic-edit-actions')).toBeNull()
    const putCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')
    expect(putCall).toBeDefined()
    const similarityCall = fetchMock.mock.calls.find(([url]) => (url as string).includes('/issues/similarity-check'))
    expect(similarityCall).toBeDefined()
  })

  it('skips the AI similarity check when editing the related location (no suggestion to compare against)', async () => {
    const fetchMock = stubConfluenceFetch()
    const relatedEditable: EditableSuggestionLocation = { ...RELATED, criteria: '', reason: '', suggestion: null }
    setActiveSuggestion({ current: relatedEditable, related: null, doneLocations: [] })
    const el = document.querySelector<HTMLElement>('.sunnic-loc-current')
    if (!el) throw new Error('current paragraph not found')
    clickInto(el as HTMLElement)
    el.textContent = '결제 실패 시 재시도 안내 문구를 노출한다'

    document.querySelector<HTMLButtonElement>('.sunnic-edit-actions-save')?.click()

    await vi.waitFor(() => {
      expect(chrome.runtime.sendMessage).toHaveBeenCalled()
    })
    const similarityCall = fetchMock.mock.calls.find(([url]) => (url as string).includes('/issues/similarity-check'))
    expect(similarityCall).toBeUndefined()
  })
})

describe('scrollToLocation', () => {
  it('scrolls the page to center the matching paragraph and returns true, without leaving a persistent tint', () => {
    const scrollSpy = vi.fn()
    window.scrollTo = scrollSpy

    const result = scrollToLocation(CURRENT)

    expect(result).toBe(true)
    expect(scrollSpy).toHaveBeenCalled()
    expect(document.querySelector('.sunnic-loc-current')).toBeNull()
  })

  it('returns false when neither the text nor a matching heading exist', () => {
    const result = scrollToLocation({ text: '문서에 없는 문구', location: '문서에 없는 제목' })

    expect(result).toBe(false)
  })
})

describe('showQaPassedBadge / clearQaPassedBadge', () => {
  it('injects a badge next to the document title and removes it on clear', () => {
    document.body.innerHTML = '<h1>PRD 문서</h1>'

    showQaPassedBadge()
    expect(document.querySelector('h1 .sunnic-qa-passed-badge')?.textContent).toBe('✓ QA 통과')

    clearQaPassedBadge()
    expect(document.querySelector('.sunnic-qa-passed-badge')).toBeNull()
  })

  it('does nothing when the page has no h1', () => {
    document.body.innerHTML = '<p>제목 없는 페이지</p>'

    expect(() => showQaPassedBadge()).not.toThrow()
    expect(document.querySelector('.sunnic-qa-passed-badge')).toBeNull()
  })

  // 새로고침 직후엔 컨플루언스 자신의 SPA가 아직 h1을 렌더링하기 전에 이 요청이 도착할 수 있다 —
  // 그 경우에도 h1이 나타나면 뒤늦게라도 배지가 붙어야 한다(2026-08-30 실사용 보고로 확인된 버그).
  it('retries until h1 appears, then shows the badge', () => {
    vi.useFakeTimers()
    document.body.innerHTML = '<p>아직 렌더링 안 된 페이지</p>'

    showQaPassedBadge()
    expect(document.querySelector('.sunnic-qa-passed-badge')).toBeNull()

    document.body.innerHTML = '<h1>PRD 문서</h1>'
    vi.advanceTimersByTime(300)
    expect(document.querySelector('h1 .sunnic-qa-passed-badge')?.textContent).toBe('✓ QA 통과')

    vi.useRealTimers()
  })

  it('clearing cancels a pending retry so a badge never appears later', () => {
    vi.useFakeTimers()
    document.body.innerHTML = '<p>아직 렌더링 안 된 페이지</p>'

    showQaPassedBadge()
    clearQaPassedBadge()
    document.body.innerHTML = '<h1>PRD 문서</h1>'
    vi.advanceTimersByTime(5000)

    expect(document.querySelector('.sunnic-qa-passed-badge')).toBeNull()
    vi.useRealTimers()
  })

  it('never stacks more than one badge, even when show is called repeatedly', () => {
    document.body.innerHTML = '<h1>PRD 문서</h1>'

    showQaPassedBadge()
    showQaPassedBadge()
    showQaPassedBadge()

    expect(document.querySelectorAll('.sunnic-qa-passed-badge')).toHaveLength(1)
  })

  // SPA가 h1을 다시 그리는 사이 재시도 타이머(이미 큐에 들어간 stale 콜백)와 새 show가 겹쳐
  // 배지가 두 개 붙던 회귀(제목에 "✓ QA 통과"가 여러 번). 세대 토큰 + append 직전 중복 체크로 방지.
  it('does not stack a badge when a stale retry fires after a fresh show', () => {
    vi.useFakeTimers()
    document.body.innerHTML = '<p>아직 렌더링 안 된 페이지</p>'

    showQaPassedBadge() // h1 없음 → 재시도 예약
    document.body.innerHTML = '<h1>PRD 문서</h1>'
    showQaPassedBadge() // h1 있음 → 즉시 append (이전 재시도 체인은 무효화돼야 함)
    vi.advanceTimersByTime(5000) // stale 재시도 콜백들이 전부 소진되도록

    expect(document.querySelectorAll('.sunnic-qa-passed-badge')).toHaveLength(1)
    vi.useRealTimers()
  })

  it('sweeps up multiple pre-existing badges on clear', () => {
    document.body.innerHTML =
      '<h1>PRD 문서<span class="sunnic-qa-passed-badge">✓ QA 통과</span>' +
      '<span class="sunnic-qa-passed-badge">✓ QA 통과</span></h1>'

    clearQaPassedBadge()

    expect(document.querySelector('.sunnic-qa-passed-badge')).toBeNull()
  })
})

describe('formatKstTimestamp', () => {
  it('formats a KST noon (UTC 03:00) correctly', () => {
    expect(formatKstTimestamp(new Date('2026-08-10T03:00:00Z'))).toBe('2026. 8. 10. 오후 12:00:00')
  })

  it('formats a KST midnight (crossing into the next day) correctly', () => {
    expect(formatKstTimestamp(new Date('2026-08-09T15:30:00Z'))).toBe('2026. 8. 10. 오전 12:30:00')
  })

  it('formats a regular afternoon time correctly', () => {
    expect(formatKstTimestamp(new Date('2026-08-10T06:15:05Z'))).toBe('2026. 8. 10. 오후 3:15:05')
  })
})

describe('applyIssueEdit', () => {
  it('the first call creates a duplicate page instead of touching the original', async () => {
    const fetchMock = stubConfluenceFetch()

    const result = await applyIssueEdit('issue-1', CURRENT.text, '4사만 지원, 페이코 미지원')

    expect(result).toEqual({ ok: true })

    const putCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')
    expect((putCall?.[0] as string)).toContain(DUPLICATE_PAGE_ID)
    const originalPut = fetchMock.mock.calls.find(
      ([url, init]) => (init as RequestInit | undefined)?.method === 'PUT' && (url as string).includes(ORIGINAL_PAGE_ID),
    )
    expect(originalPut).toBeUndefined()

    const postCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
    expect(postCall).toBeDefined()

    const putBody = JSON.parse((putCall?.[1] as RequestInit).body as string) as {
      body: { storage: { value: string } }
    }
    expect(putBody.body.storage.value).toContain('4사만 지원, 페이코 미지원')
  })

  it('finds the original page id even from a new-editor draft URL ("/pages/edit-v2/{id}")', async () => {
    ;(window as unknown as HappyDomWindow).happyDOM.setURL(
      `http://localhost:8000/mock-confluence/pages/edit-v2/${ORIGINAL_PAGE_ID}?draftShareId=abc`,
    )
    const fetchMock = stubConfluenceFetch()

    const result = await applyIssueEdit('issue-1', CURRENT.text, '4사만 지원, 페이코 미지원')

    expect(result).toEqual({ ok: true })
    const originalGet = fetchMock.mock.calls.find(([url]) => (url as string).includes(ORIGINAL_PAGE_ID))
    expect(originalGet).toBeDefined()
  })

  it('stamps the duplicate title with Korea time computed by pure arithmetic, not Intl', async () => {
    vi.stubEnv('TZ', 'UTC')
    const fixedNow = new Date('2026-08-10T03:00:00Z')
    vi.useFakeTimers()
    vi.setSystemTime(fixedNow)
    try {
      const fetchMock = stubConfluenceFetch()

      await applyIssueEdit('issue-1', CURRENT.text, '4사만 지원, 페이코 미지원')

      const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
      const body = JSON.parse((postCall?.[1] as RequestInit).body as string) as { title: string }
      expect(body.title).toContain('2026. 8. 10. 오후 12:00:00')
    } finally {
      vi.useRealTimers()
      vi.unstubAllEnvs()
    }
  })

  it('a second call reuses the same duplicate page instead of creating another one', async () => {
    const fetchMock = stubConfluenceFetch({
      duplicateBody: `${PAGE_HTML}<p>결제 실패 원인에 대한 안내가 필요하다.</p>`,
    })

    await applyIssueEdit('issue-1', CURRENT.text, '4사만 지원, 페이코 미지원')
    await applyIssueEdit('issue-2', '결제 실패 원인', '결제 실패 원인(수정)')

    const puts = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')
    const posts = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
    expect(puts).toHaveLength(2)
    expect(posts).toHaveLength(1)
  })

  it('fails without creating a duplicate when not on a Confluence page URL', async () => {
    ;(window as unknown as HappyDomWindow).happyDOM.setURL('http://localhost:8000/not-a-confluence-page')
    stubConfluenceFetch()

    const result = await applyIssueEdit('issue-1', CURRENT.text, '4사만 지원, 페이코 미지원')

    expect(result.ok).toBe(false)
  })

  it('returns an error when the duplicate cannot be created', async () => {
    stubConfluenceFetch({ createOk: false })

    const result = await applyIssueEdit('issue-1', CURRENT.text, '4사만 지원, 페이코 미지원')

    expect(result.ok).toBe(false)
  })

  it('returns an error when the original text is missing from the duplicate', async () => {
    stubConfluenceFetch({ duplicateBody: '<p>완전히 다른 본문</p>' })

    const result = await applyIssueEdit('issue-1', CURRENT.text, '4사만 지원, 페이코 미지원')

    expect(result).toEqual({ ok: false, error: '원문에서 해당 문구를 찾지 못했습니다.' })
  })

  it('still finds the text in storage HTML when its whitespace differs from the live DOM', async () => {
    const fetchMock = stubConfluenceFetch({ duplicateBody: '<p>3사만  지원,\n페이코 미지원</p>' })

    const result = await applyIssueEdit('issue-1', CURRENT.text, '4사만 지원, 페이코 미지원')

    expect(result).toEqual({ ok: true })
    const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')
    const putBody = JSON.parse(putCall?.[1]?.body as string)
    expect(putBody.body.storage.value).toBe('<p>4사만 지원, 페이코 미지원</p>')
  })

  it('finds and replaces a list item even though oldText carries the synthetic "- " bullet prefix the model quoted', async () => {
    const oldText = '- 신규 입고 상품 섹션의 체류 시간이 타 섹션 대비 낮음'
    const newText = '신규 입고 상품 섹션의 체류 시간이 타 섹션 대비 25% 낮음'
    const fetchMock = stubConfluenceFetch({
      duplicateBody: '<ul><li>신규 입고 상품 섹션의 체류 시간이 타 섹션 대비 낮음</li></ul>',
    })

    const result = await applyIssueEdit('issue-bullet-prefix', oldText, newText)

    expect(result).toEqual({ ok: true })
    const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')
    const putBody = JSON.parse(putCall?.[1]?.body as string)
    expect(putBody.body.storage.value).toBe(`<ul><li>${newText}</li></ul>`)
  })

  it('still matches when an unrelated part of the document has an HTML entity like &rarr;', async () => {
    const oldText =
      '홈 UV (Unique Visitor) 월 2만명 달성근거: 구매 전환율 1.5% 목표 달성을 위해 장바구니 유입 최소 1,000명 필요.'
    const newText = '실제 퍼널 수치를 재계산하여 일관된 근거로 제시'
    const fragment =
      '<li><p><strong>홈 UV (Unique Visitor) 월 2만명 달성</strong><br />근거: 구매 전환율 1.5% 목표 달성을 위해 ' +
      '장바구니 유입 최소 1,000명 필요. 홈&rarr;장바구니 이탈율 95% 가정 시 월 2만명 유입 필요.</p></li>'
    const fetchMock = stubConfluenceFetch({ duplicateBody: fragment })

    const result = await applyIssueEdit('issue-entity', oldText, newText)

    expect(result).toEqual({ ok: true })
    const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')
    const putBody = JSON.parse(putCall?.[1]?.body as string)
    expect(putBody.body.storage.value).toBe(
      `<li><p><strong>${newText}</strong><br /> 홈&rarr;장바구니 이탈율 95% 가정 시 월 2만명 유입 필요.</p></li>`,
    )
  })

  it('overwrites the heading text directly in the live DOM when the edit targets a heading (numbering fixes have no highlight mark)', async () => {
    // 넘버링 이슈는 applyIssueOverlay로 하이라이트된 적이 없어(overwriteMarkText가 못 찾음),
    // 저장이 복제본에 성공해도 지금 보고 있는 화면엔 아무 변화가 없어 "반영 안 됐다"는 오인으로
    // 이어졌다(실사용 확인) — 헤딩 텍스트를 직접 찾아 로컬로 덮어써야 한다.
    document.body.innerHTML = '<main><h2>4. 해결 방안</h2><p>본문</p></main>'
    const fetchMock = stubConfluenceFetch({ duplicateBody: '<h2>4. 해결 방안</h2><p>본문</p>' })

    const result = await applyIssueEdit('numbering-issue-1', '4. 해결 방안', '3. 해결 방안')

    expect(result).toEqual({ ok: true })
    expect(document.querySelector('h2')?.textContent).toBe('3. 해결 방안')
    const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')
    const putBody = JSON.parse(putCall?.[1]?.body as string)
    expect(putBody.body.storage.value).toBe('<h2>3. 해결 방안</h2><p>본문</p>')
  })

  it('preserves inline markup inside the heading when only the number segment differs', async () => {
    document.body.innerHTML = '<main><h2>4. 해결 <strong>방안</strong></h2></main>'
    stubConfluenceFetch({ duplicateBody: '<h2>4. 해결 <strong>방안</strong></h2>' })

    const result = await applyIssueEdit('numbering-issue-2', '4. 해결 방안', '3. 해결 방안')

    expect(result).toEqual({ ok: true })
    expect(document.querySelector('h2')?.textContent).toBe('3. 해결 방안')
    expect(document.querySelector('h2 strong')).not.toBeNull()
  })

  it('does not throw and leaves the DOM untouched when no heading matches oldText', async () => {
    document.body.innerHTML = '<main><h2>다른 제목</h2></main>'
    stubConfluenceFetch({ duplicateBody: '<p>4. 해결 방안</p>' })

    const result = await applyIssueEdit('numbering-issue-3', '4. 해결 방안', '3. 해결 방안')

    expect(result).toEqual({ ok: true })
    expect(document.querySelector('h2')?.textContent).toBe('다른 제목')
  })
})

describe('getActiveDuplicatePageId', () => {
  it('returns null before any edit has been applied (no duplicate created yet)', () => {
    expect(getActiveDuplicatePageId(ORIGINAL_PAGE_ID)).toBeNull()
  })

  it('returns the duplicate page id once an edit has been applied', async () => {
    stubConfluenceFetch()

    await applyIssueEdit('issue-1', CURRENT.text, '4사만 지원, 페이코 미지원')

    expect(getActiveDuplicatePageId(ORIGINAL_PAGE_ID)).toBe(DUPLICATE_PAGE_ID)
  })

  it('returns null when asked about a different original page (stale SPA session)', async () => {
    stubConfluenceFetch()

    await applyIssueEdit('issue-1', CURRENT.text, '4사만 지원, 페이코 미지원')

    expect(getActiveDuplicatePageId('999999')).toBeNull()
  })
})

describe('commitDocumentEdits', () => {
  // 복제본 세션이 없는 상태에서: STEP 3는 원본을 읽고, 실제 반영 시 원본을 복제해 저장한다.
  function stubFetchForCommit(storedHtml: string, dupHtml?: string): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return new Response(JSON.stringify({ ok: true }), { status: 200 })
      if (init?.method === 'POST') return new Response(JSON.stringify({ id: DUPLICATE_PAGE_ID }), { status: 200 })
      const value = url.includes(DUPLICATE_PAGE_ID) ? (dupHtml ?? storedHtml) : storedHtml
      return new Response(
        JSON.stringify({ title: 'PRD', space: { key: 'MFS' }, version: { number: 1 }, body: { storage: { value } } }),
        { status: 200 },
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  const putBodies = (fetchMock: ReturnType<typeof vi.fn>): string[] =>
    fetchMock.mock.calls
      .filter(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')
      .map(([, init]) => JSON.parse((init as RequestInit).body as string).body.storage.value as string)

  it('reconciles only the heading whose number changed in the live DOM', async () => {
    document.body.innerHTML = '<main><h2>1. 개요</h2><h2>3. 문제 정의</h2></main>'
    const fetchMock = stubFetchForCommit('<h2>1. 개요</h2><h2>2. 문제 정의</h2>')

    const result = await commitDocumentEdits()

    expect(result).toEqual({ ok: true, reconciled: 1 })
    expect(putBodies(fetchMock)).toEqual(['<h2>1. 개요</h2><h2>3. 문제 정의</h2>'])
  })

  it('changes only the number segment, preserving the rest of the title verbatim', async () => {
    document.body.innerHTML = '<main><h2>1. 개요</h2><h2>2. 해결 방안(안건 A)</h2></main>'
    const fetchMock = stubFetchForCommit('<h2>1. 개요</h2><h2>3. 해결 방안(안건 A)</h2>')

    const result = await commitDocumentEdits()

    expect(result).toEqual({ ok: true, reconciled: 1 })
    expect(putBodies(fetchMock)).toEqual(['<h2>1. 개요</h2><h2>2. 해결 방안(안건 A)</h2>'])
  })

  it('skips position matching entirely when heading counts differ (insert/delete)', async () => {
    document.body.innerHTML = '<main><h2>1. 개요</h2><h2>2. 문제 정의</h2><h2>3. 해결 방안</h2></main>'
    const fetchMock = stubFetchForCommit('<h2>1. 개요</h2><h2>2. 문제 정의</h2>')

    const result = await commitDocumentEdits()

    expect(result).toEqual({ ok: true, reconciled: 0, skippedCountMismatch: true })
    expect(putBodies(fetchMock)).toEqual([])
  })

  it('does not auto-reconcile a heading whose stored text is not unique (identical duplicate heading)', async () => {
    document.body.innerHTML = '<main><h2>3. 개요</h2><h2>4. 개요</h2></main>'
    const fetchMock = stubFetchForCommit('<h2>3. 개요</h2><h2>3. 개요</h2>')

    const result = await commitDocumentEdits()

    expect(result).toEqual({ ok: true, reconciled: 0 })
    expect(putBodies(fetchMock)).toEqual([])
  })

  it('passes current live sub-heading numbers through even without a saved suggestion (real user bug)', async () => {
    document.body.innerHTML =
      '<main><h2>1. 개요</h2><h3>1-1. 목적</h3><h3>1-2. 적용 범위</h3>' +
      '<h2>2. 문제 정의</h2><h3>2-2. 배경</h3><h3>2-3. 문제점</h3></main>'
    const stored =
      '<h2>1. 개요</h2><h3>1-1. 목적</h3><h3>1-2. 적용 범위</h3>' +
      '<h2>2. 문제 정의</h2><h3>2-1. 배경</h3><h3>2-2. 문제점</h3>'
    const fetchMock = stubFetchForCommit(stored)

    const result = await commitDocumentEdits()

    expect(result).toEqual({ ok: true, reconciled: 2 })
    expect(putBodies(fetchMock)).toEqual([
      '<h2>1. 개요</h2><h3>1-1. 목적</h3><h3>1-2. 적용 범위</h3>' +
        '<h2>2. 문제 정의</h2><h3>2-2. 배경</h3><h3>2-3. 문제점</h3>',
    ])
  })

  it('ignores a heading whose title changed but number did not (out of numbering scope)', async () => {
    document.body.innerHTML = '<main><h2>1. 개요</h2><h2>2. 문제 정의 및 배경</h2></main>'
    const fetchMock = stubFetchForCommit('<h2>1. 개요</h2><h2>2. 문제 정의</h2>')

    const result = await commitDocumentEdits()

    expect(result).toEqual({ ok: true, reconciled: 0 })
    expect(putBodies(fetchMock)).toEqual([])
  })

  it('does nothing when the live headings already match the stored ones', async () => {
    document.body.innerHTML = '<main><h2>1. 개요</h2><h2>2. 문제 정의</h2></main>'
    const fetchMock = stubFetchForCommit('<h2>1. 개요</h2><h2>2. 문제 정의</h2>')

    const result = await commitDocumentEdits()

    expect(result).toEqual({ ok: true, reconciled: 0 })
    expect(putBodies(fetchMock)).toEqual([])
  })

  it('fails without a PUT when not on a Confluence page URL', async () => {
    ;(window as unknown as HappyDomWindow).happyDOM.setURL('http://localhost:8000/not-a-confluence-page')
    const fetchMock = stubFetchForCommit('<h2>1. 개요</h2>')

    const result = await commitDocumentEdits()

    expect(result.ok).toBe(false)
    expect(putBodies(fetchMock)).toEqual([])
  })
})
