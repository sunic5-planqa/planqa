import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetDuplicateSessionForTests,
  applyIssueEdit,
  applyIssueOverlay,
  clearIssueOverlay,
  formatKstTimestamp,
  scrollToIssue,
} from './issueOverlay'
import type { OverlayIssue } from './messages'

const ISSUE: OverlayIssue = {
  id: 'issue-1',
  input_text: '3사만 지원, 페이코 미지원',
  criteria: '용어 및 단어의 일관성',
  reason: '테스트용 이유',
  suggestion: '4사만 지원, 페이코 미지원',
  location: '결제 수단',
}

const ORIGINAL_PAGE_ID = '482910'
const DUPLICATE_PAGE_ID = '900001'
const PAGE_HTML = '<p>간편결제(카카오페이, 네이버페이, 토스) 3사만 지원, 페이코 미지원 안내.</p>'

// GET/POST/PUT을 흉내내는 목 fetch. 첫 적용은 원본 GET(expand=space 포함) → 복제본 POST → 복제본
// GET/PUT 순으로 나가고, 두 번째 적용부터는 복제본 GET/PUT만 나간다 — 실제 backend/mock_confluence.py의
// 동작과 같은 순서.
function stubConfluenceFetch(overrides?: { duplicateBody?: string; createOk?: boolean; putOk?: boolean }): ReturnType<typeof vi.fn> {
  const createOk = overrides?.createOk ?? true
  const putOk = overrides?.putOk ?? true
  const duplicateBody = overrides?.duplicateBody ?? PAGE_HTML

  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
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
    // duplicate page GET
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
  // test-setup.ts 전역 chrome 스텁엔 sendMessage가 없어 이 테스트에서만 보강한다.
  chrome.runtime.sendMessage = vi.fn().mockResolvedValue(undefined)
})

describe('applyIssueOverlay', () => {
  it('wraps the matching text in a highlight mark and reports it as matched', () => {
    const result = applyIssueOverlay([ISSUE])

    expect(result).toEqual({ matched: 1, total: 1 })
    const mark = document.querySelector('.sunnic-issue-highlight')
    expect(mark?.textContent).toBe(ISSUE.input_text)
    expect(mark?.getAttribute('data-sunnic-issue-id')).toBe(ISSUE.id)
  })

  it('reports 0 matched when the text is not present in the document', () => {
    const result = applyIssueOverlay([{ ...ISSUE, input_text: '문서에 없는 문구' }])

    expect(result).toEqual({ matched: 0, total: 1 })
    expect(document.querySelector('.sunnic-issue-highlight')).toBeNull()
  })

  it('matches even when the live DOM has different whitespace than input_text', () => {
    document.body.innerHTML = '<main><p>간편결제(카카오페이,   네이버페이,\n토스) 3사만 지원, 페이코 미지원 안내.</p></main>'

    const result = applyIssueOverlay([ISSUE])

    expect(result).toEqual({ matched: 1, total: 1 })
    expect(document.querySelector('.sunnic-issue-highlight')?.textContent).toBe('3사만 지원, 페이코 미지원')
  })

  it('falls back to highlighting the location heading when input_text has no match (e.g. missing-info issues)', () => {
    // "정보 누락(MI)" 같은 이슈는 애초에 원문에 없는 걸 지적하니 input_text로 찾을 대상 자체가
    // 없다 — 그럴 때도 "다음"으로 넘기면 문서가 스크롤돼야 어디를 고쳐야 하는지 알 수 있다.
    document.body.innerHTML =
      '<main><h2>6. 프로덕트 기능</h2><h3>6-1. 메인 배너 (캐러셀)</h3><p>최대 5개 슬라이드로 구성.</p></main>'
    const issue: OverlayIssue = {
      ...ISSUE,
      input_text: '자동 슬라이드 전환 간격',
      location: '6. 프로덕트 기능 > 6-1. 메인 배너 (캐러셀)',
    }

    const result = applyIssueOverlay([issue])

    expect(result).toEqual({ matched: 1, total: 1 })
    const mark = document.querySelector('.sunnic-issue-highlight')
    expect(mark?.textContent).toBe('6-1. 메인 배너 (캐러셀)')
    expect(mark?.closest('h3')).not.toBeNull()
  })

  it('never falls back to the page title (h1) even when location matches nothing but it', () => {
    // review-agent의 Document 위계(문서 전체 대상 판정) 이슈는 location이 곧 "문서 제목"이다
    // (백엔드 document.py의 _doc_title) — 이걸 그대로 폴백 대상으로 허용하면 컨플루언스 페이지
    // 자체의 제목을 감싸버려서, 마치 "제목이 문제"라는 것처럼 보이는 엉뚱한 하이라이트가 된다
    // (실사용 중 확인된 버그). h1은 폴백 대상에서 제외해야 하고, 그러면 매칭 자체가 실패해야 한다.
    document.body.innerHTML = '<main><h1>[DOC-001] NxEF 모바일 웹 — 홈 화면 PRD (v1.0)</h1><h2>1. 프로덕트 목적</h2></main>'
    const issue: OverlayIssue = {
      ...ISSUE,
      input_text: '문서에 없는 문구',
      location: '[DOC-001] NxEF 모바일 웹 — 홈 화면 PRD (v1.0)',
    }

    const result = applyIssueOverlay([issue])

    expect(result).toEqual({ matched: 0, total: 1 })
    expect(document.querySelector('.sunnic-issue-highlight')).toBeNull()
  })

  it('still highlights the other issues even if one has no location and cannot be matched', () => {
    // wrapIssue()가 이슈 하나에서 예외를 던지면 filter() 전체가 멈춰서 뒤에 있던 멀쩡한 이슈들까지
    // 하이라이트가 안 그려지는 사고로 이어졌었다(location이 없는 예전 데이터가 섞인 경우 등).
    document.body.innerHTML = `<main>${PAGE_HTML}</main>`
    const brokenIssue = { ...ISSUE, id: 'broken', input_text: '문서에 없는 문구', location: undefined as unknown as string }
    const goodIssue: OverlayIssue = { ...ISSUE, id: 'issue-2' }

    const result = applyIssueOverlay([brokenIssue, goodIssue])

    expect(result).toEqual({ matched: 1, total: 2 })
    expect(document.querySelector('[data-sunnic-issue-id="issue-2"]')).not.toBeNull()
  })

  it('reports 0 matched when neither input_text nor the location heading exist in the document', () => {
    document.body.innerHTML = '<main><h2>다른 제목</h2></main>'
    const issue: OverlayIssue = { ...ISSUE, input_text: '문서에 없는 문구', location: '문서에 없는 제목' }

    const result = applyIssueOverlay([issue])

    expect(result).toEqual({ matched: 0, total: 1 })
    expect(document.querySelector('.sunnic-issue-highlight')).toBeNull()
  })

  it('wraps every matching issue at once, not just one', () => {
    document.body.innerHTML =
      '<main><p>간편결제(카카오페이, 네이버페이, 토스) 3사만 지원, 페이코 미지원 안내.</p>' +
      '<p>PG사 응답 지연 시 타임아웃 처리 로직 부재</p></main>'
    const issue2: OverlayIssue = { ...ISSUE, id: 'issue-2', input_text: 'PG사 응답 지연 시 타임아웃 처리 로직 부재' }

    const result = applyIssueOverlay([ISSUE, issue2])

    expect(result).toEqual({ matched: 2, total: 2 })
    expect(document.querySelectorAll('.sunnic-issue-highlight')).toHaveLength(2)
  })

  it('matches text that spans a label and a separate badge element (e.g. a status lozenge)', () => {
    // 실제 컨플루언스에서 "상태: 검토 중" 같은 문구는 라벨 텍스트 노드와 별도 뱃지 엘리먼트로 쪼개져
    // 렌더링되는 경우가 흔함 — 한 텍스트 노드 안에서만 찾던 예전 방식은 이런 경우를 놓쳤다.
    document.body.innerHTML = '<p>상태: <span class="lozenge">검토 중</span> 입니다.</p>'
    const issue: OverlayIssue = { ...ISSUE, input_text: '상태: 검토 중' }

    const result = applyIssueOverlay([issue])

    expect(result).toEqual({ matched: 1, total: 1 })
    const marks = document.querySelectorAll('.sunnic-issue-highlight')
    expect(marks.length).toBeGreaterThanOrEqual(2)
    expect(Array.from(marks).every((m) => m.getAttribute('data-sunnic-issue-id') === issue.id)).toBe(true)
    expect(Array.from(marks).map((m) => m.textContent).join('')).toBe('상태: 검토 중')
  })

  it('merges every mark of a multi-element match into one on apply, showing the new text', async () => {
    stubConfluenceFetch({ duplicateBody: '<p>상태: 검토 중</p>' })
    document.body.innerHTML = '<p>상태: <span class="lozenge">검토 중</span></p>'
    const issue: OverlayIssue = { ...ISSUE, input_text: '상태: 검토 중' }
    applyIssueOverlay([issue])
    expect(document.querySelectorAll('.sunnic-issue-highlight').length).toBeGreaterThanOrEqual(2)

    await applyIssueEdit(issue.id, issue.input_text, '검토 완료')

    const marks = document.querySelectorAll('.sunnic-issue-highlight')
    expect(marks.length).toBe(1)
    expect(marks[0].classList.contains('sunnic-issue-resolved')).toBe(true)
    expect(marks[0].textContent).toBe('검토 완료')
  })

  it('overwrites the mark text in place after a single-element apply', async () => {
    stubConfluenceFetch()
    applyIssueOverlay([ISSUE])

    await applyIssueEdit(ISSUE.id, ISSUE.input_text, ISSUE.suggestion)

    const mark = document.querySelector('.sunnic-issue-highlight')
    expect(mark?.textContent).toBe(ISSUE.suggestion)
  })

  it('clicking a highlight shows a read-only AI 제안 bubble and focuses the sidepanel on it', () => {
    applyIssueOverlay([ISSUE])
    const mark = document.querySelector<HTMLElement>('.sunnic-issue-highlight')
    mark?.click()

    const tooltip = document.querySelector('.sunnic-issue-tooltip')
    expect(tooltip?.textContent).toContain('AI 제안')
    expect(tooltip?.textContent).toContain(ISSUE.suggestion)
    expect(tooltip?.querySelector('button')).toBeNull()

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'ISSUE_OVERLAY_FOCUS', issueId: ISSUE.id })
  })

  it('highlights quoted spans in the AI 제안 text with a gradient, leaving the rest plain', () => {
    // 문장 전체를 다 강조하면 오히려 핵심이 안 보여서, 따옴표로 감싼 구체적 제안치/인용구만 강조한다.
    const issue: OverlayIssue = { ...ISSUE, suggestion: "마일스톤의 P2 항목을 '핵클 SDK 연동'으로 수정" }
    applyIssueOverlay([issue])
    document.querySelector<HTMLElement>('.sunnic-issue-highlight')?.click()

    const quoted = document.querySelector('.sunnic-issue-tooltip .sunnic-tooltip-quote')
    expect(quoted?.textContent).toBe("'핵클 SDK 연동'")
    expect(document.querySelector('.sunnic-issue-tooltip')?.textContent).toContain(issue.suggestion)
  })

  it('escapes HTML special characters in the AI 제안 text instead of interpreting them as markup', () => {
    const issue: OverlayIssue = { ...ISSUE, suggestion: '<b>업계 평균</b> & "3 < 5" 확인' }
    applyIssueOverlay([issue])
    document.querySelector<HTMLElement>('.sunnic-issue-highlight')?.click()

    const tooltip = document.querySelector('.sunnic-issue-tooltip')
    expect(tooltip?.querySelector('b')).toBeNull()
    expect(tooltip?.textContent).toContain('<b>업계 평균</b> & "3 < 5" 확인')
  })

  it('clicking the same highlight again closes the bubble', () => {
    applyIssueOverlay([ISSUE])
    const mark = document.querySelector<HTMLElement>('.sunnic-issue-highlight')
    mark?.click()
    mark?.click()

    expect(document.querySelector('.sunnic-issue-tooltip')).toBeNull()
  })
})

describe('clearIssueOverlay', () => {
  it('unwraps highlight marks back to plain text', () => {
    applyIssueOverlay([ISSUE])
    clearIssueOverlay()

    expect(document.querySelector('.sunnic-issue-highlight')).toBeNull()
    expect(document.querySelector('main')?.textContent).toContain(ISSUE.input_text)
  })
})

describe('formatKstTimestamp', () => {
  it('formats a KST noon (UTC 03:00) correctly', () => {
    expect(formatKstTimestamp(new Date('2026-08-10T03:00:00Z'))).toBe('2026. 8. 10. 오후 12:00:00')
  })

  it('formats a KST midnight (crossing into the next day) correctly', () => {
    // UTC 15:30 + 9시간 = 다음날 00:30 KST — hour24가 0으로 넘어가는 경계(오전 12시 표기) 확인.
    expect(formatKstTimestamp(new Date('2026-08-09T15:30:00Z'))).toBe('2026. 8. 10. 오전 12:30:00')
  })

  it('formats a regular afternoon time correctly', () => {
    // UTC 06:15 + 9시간 = 15:15 KST = 오후 3시 15분.
    expect(formatKstTimestamp(new Date('2026-08-10T06:15:05Z'))).toBe('2026. 8. 10. 오후 3:15:05')
  })
})

describe('applyIssueEdit', () => {
  it('the first call creates a duplicate page instead of touching the original, and marks the highlight resolved', async () => {
    const fetchMock = stubConfluenceFetch()
    applyIssueOverlay([ISSUE])
    const mark = document.querySelector<HTMLElement>('.sunnic-issue-highlight')

    const result = await applyIssueEdit(ISSUE.id, ISSUE.input_text, ISSUE.suggestion)

    expect(result).toEqual({ ok: true })
    expect(mark?.classList.contains('sunnic-issue-resolved')).toBe(true)

    const putCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')
    expect((putCall?.[0] as string)).toContain(DUPLICATE_PAGE_ID)
    const originalPut = fetchMock.mock.calls.find(
      ([url, init]) => (init as RequestInit | undefined)?.method === 'PUT' && (url as string).includes(ORIGINAL_PAGE_ID),
    )
    expect(originalPut).toBeUndefined()

    const postCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
    expect(postCall).toBeDefined()

    const putBody = JSON.parse((putCall?.[1] as RequestInit).body as string) as { body: { storage: { value: string } } }
    expect(putBody.body.storage.value).toContain(ISSUE.suggestion)
  })

  it('stamps the duplicate title with Korea time computed by pure arithmetic, not Intl', async () => {
    // timeZone: 'Asia/Seoul'을 명시한 toLocaleString도 실제 서비스 환경에서 여전히 몇 시간씩
    // 어긋난다는 보고가 있어(Intl 구현/환경에 따라 달라질 여지가 남아있었던 걸로 보임), Intl에
    // 아예 기대지 않는 순수 산술 계산(UTC+9 고정 오프셋)으로 바꿨다 — 시스템 시간대를 UTC로
    // 바꿔놔도(vi.stubEnv) 항상 KST로 정확히 찍혀야 한다.
    vi.stubEnv('TZ', 'UTC')
    const fixedNow = new Date('2026-08-10T03:00:00Z') // KST로는 정오(오후 12시)
    vi.useFakeTimers()
    vi.setSystemTime(fixedNow)
    try {
      const fetchMock = stubConfluenceFetch()

      await applyIssueEdit(ISSUE.id, ISSUE.input_text, ISSUE.suggestion)

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

    await applyIssueEdit(ISSUE.id, ISSUE.input_text, ISSUE.suggestion)
    await applyIssueEdit('issue-2', '결제 실패 원인', '결제 실패 원인(수정)')

    const puts = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')
    const posts = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
    expect(puts).toHaveLength(2)
    expect(posts).toHaveLength(1)
  })

  it('fails without creating a duplicate when not on a Confluence page URL', async () => {
    ;(window as unknown as HappyDomWindow).happyDOM.setURL('http://localhost:8000/not-a-confluence-page')
    stubConfluenceFetch()

    const result = await applyIssueEdit(ISSUE.id, ISSUE.input_text, ISSUE.suggestion)

    expect(result.ok).toBe(false)
  })

  it('returns an error and does not mark resolved when the duplicate cannot be created', async () => {
    stubConfluenceFetch({ createOk: false })
    applyIssueOverlay([ISSUE])
    const mark = document.querySelector<HTMLElement>('.sunnic-issue-highlight')

    const result = await applyIssueEdit(ISSUE.id, ISSUE.input_text, ISSUE.suggestion)

    expect(result.ok).toBe(false)
    expect(mark?.classList.contains('sunnic-issue-resolved')).toBe(false)
  })

  it('returns an error when the original text is missing from the duplicate', async () => {
    stubConfluenceFetch({ duplicateBody: '<p>완전히 다른 본문</p>' })

    const result = await applyIssueEdit(ISSUE.id, ISSUE.input_text, ISSUE.suggestion)

    expect(result).toEqual({ ok: false, error: '원문에서 해당 문구를 찾지 못했습니다.' })
  })

  it('still finds the text in storage HTML when its whitespace differs from the live DOM', async () => {
    // storage HTML의 줄바꿈/연속 공백이 화면에 렌더링된 것과 완전히 같지 않은 흔한 경우 — 예전엔
    // 여기서만 완전 일치(includes)로 찾아서, 화면엔 분명히 보이는 문구인데 저장이 실패했었다.
    const fetchMock = stubConfluenceFetch({ duplicateBody: '<p>3사만  지원,\n페이코 미지원</p>' })

    const result = await applyIssueEdit(ISSUE.id, ISSUE.input_text, ISSUE.suggestion)

    expect(result).toEqual({ ok: true })
    const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')
    const putBody = JSON.parse(putCall?.[1]?.body as string)
    expect(putBody.body.storage.value).toBe(`<p>${ISSUE.suggestion}</p>`)
  })

  it('finds and replaces text that spans two separate list items with no whitespace between them', async () => {
    // 사람 눈엔 한 문장처럼 붙어 보여도, 실제 storage HTML에서는 서로 다른 <li> 태그에 나뉘어
    // 있고 그 사이에 공백조차 없는 경우 — 공백만 관대하게 봐주는 단순 정규식으로는 못 찾는다.
    const oldText = '홈 UV 달성근거: 구매 전환율 필요'
    const newText = '실제 퍼널 수치 재계산'
    const fetchMock = stubConfluenceFetch({ duplicateBody: '<ul><li>홈 UV 달성</li><li>근거: 구매 전환율 필요</li></ul>' })

    const result = await applyIssueEdit('issue-multi-li', oldText, newText)

    expect(result).toEqual({ ok: true })
    const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')
    const putBody = JSON.parse(putCall?.[1]?.body as string)
    expect(putBody.body.storage.value).toBe(`<ul><li>${newText}</li><li></li></ul>`)
  })

  it('finds text split by a <strong> close tag and a <br> inside one <p> (real DOC-001 shape)', async () => {
    // 실제 DOC-001 페이지에서 재현된 구조 그대로 — 볼드로 감싼 구절 뒤에 <br>로 줄바꿈하고 이어지는
    // 문장이 붙는 흔한 패턴("**핵심 지표**\n근거: ...")이 서로 다른 텍스트 노드로 쪼개진다.
    const oldText =
      '홈 UV (Unique Visitor) 월 2만명 달성근거: 구매 전환율 1.5% 목표 달성을 위해 장바구니 유입 최소 1,000명 필요.'
    const newText = '실제 퍼널 수치를 재계산하여 일관된 근거로 제시'
    const fragment =
      '<li><p><strong>홈 UV (Unique Visitor) 월 2만명 달성</strong><br>근거: 구매 전환율 1.5% 목표 달성을 위해 ' +
      '장바구니 유입 최소 1,000명 필요. 홈→장바구니 이탈율 95% 가정 시 월 2만명 유입 필요.</p></li>'
    const fetchMock = stubConfluenceFetch({ duplicateBody: fragment })

    const result = await applyIssueEdit('issue-strong-br', oldText, newText)

    expect(result).toEqual({ ok: true })
    const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')
    const putBody = JSON.parse(putCall?.[1]?.body as string)
    // <strong>/<br> 태그 자체는 건드리지 않고, 그 사이에 있던 텍스트 노드 내용만 치환된다.
    expect(putBody.body.storage.value).toBe(
      `<li><p><strong>${newText}</strong><br> 홈→장바구니 이탈율 95% 가정 시 월 2만명 유입 필요.</p></li>`,
    )
  })

  it('still matches when an unrelated part of the document has an HTML entity like &rarr;', async () => {
    // 실제 DOC-001에서 재현된 그대로 — "→"가 storage HTML에는 &rarr; 엔티티로 저장돼 있었다. 매치
    // 구간 자체는 그 엔티티 앞에서 끝나지만, 예전 구현(디코딩한 텍스트를 원본에서 다시 찾는 방식)은
    // 이 엔티티 때문에 그 엘리먼트의 전체 텍스트를 원본에서 못 찾아 실패했었다.
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
    // 매치 밖에 있던 &rarr; 엔티티는 그대로(디코딩되지 않고) 보존돼야 한다.
    expect(putBody.body.storage.value).toBe(
      `<li><p><strong>${newText}</strong><br /> 홈&rarr;장바구니 이탈율 95% 가정 시 월 2만명 유입 필요.</p></li>`,
    )
  })
})

describe('scrollToIssue', () => {
  it('scrolls the matching highlight into view and returns true', () => {
    applyIssueOverlay([ISSUE])
    const mark = document.querySelector<HTMLElement>('.sunnic-issue-highlight')
    const scrollSpy = vi.fn()
    if (mark) mark.scrollIntoView = scrollSpy

    const result = scrollToIssue(ISSUE.id)

    expect(result).toBe(true)
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
  })

  it('returns false for an issue that was never wrapped', () => {
    applyIssueOverlay([ISSUE])

    expect(scrollToIssue('no-such-issue')).toBe(false)
  })

  it('also shows the AI 제안 bubble for the issue being scrolled to, without needing a click', () => {
    applyIssueOverlay([ISSUE])
    const mark = document.querySelector<HTMLElement>('.sunnic-issue-highlight')
    if (mark) mark.scrollIntoView = vi.fn()

    scrollToIssue(ISSUE.id)

    const tooltip = document.querySelector('.sunnic-issue-tooltip')
    expect(tooltip?.textContent).toContain(ISSUE.suggestion)
  })

  it('marks the scrolled-to issue as active (gradient highlight) and clears it from the previous one', () => {
    const other: OverlayIssue = { ...ISSUE, id: 'issue-2', input_text: '결제 실패 원인' }
    document.body.innerHTML = `<main>${PAGE_HTML}<p>결제 실패 원인</p></main>`
    applyIssueOverlay([ISSUE, other])
    const marks = document.querySelectorAll<HTMLElement>('.sunnic-issue-highlight')
    for (const mark of marks) mark.scrollIntoView = vi.fn()

    scrollToIssue(ISSUE.id)
    expect(document.querySelector(`[data-sunnic-issue-id="${ISSUE.id}"]`)?.classList.contains('sunnic-issue-active')).toBe(true)

    scrollToIssue(other.id)
    expect(document.querySelector(`[data-sunnic-issue-id="${ISSUE.id}"]`)?.classList.contains('sunnic-issue-active')).toBe(false)
    expect(document.querySelector(`[data-sunnic-issue-id="${other.id}"]`)?.classList.contains('sunnic-issue-active')).toBe(true)
  })

  it('keeps the AI 제안 bubble tracking the mark position as the page keeps scrolling', () => {
    applyIssueOverlay([ISSUE])
    const mark = document.querySelector<HTMLElement>('.sunnic-issue-highlight')
    if (!mark) throw new Error('mark not found')
    mark.scrollIntoView = vi.fn()
    mark.getBoundingClientRect = vi.fn().mockReturnValue({ top: 500, bottom: 520, left: 10, right: 100 } as DOMRect)

    scrollToIssue(ISSUE.id)
    const tooltip = document.querySelector<HTMLElement>('.sunnic-issue-tooltip')
    expect(tooltip?.style.top).toBe('526px')

    // scrollIntoView's smooth animation lands the mark somewhere else by the time scrolling settles —
    // the bubble must follow, not stay pinned to the pre-scroll position.
    mark.getBoundingClientRect = vi.fn().mockReturnValue({ top: 120, bottom: 140, left: 10, right: 100 } as DOMRect)
    window.dispatchEvent(new Event('scroll'))

    expect(tooltip?.style.top).toBe('146px')
  })

  it('self-corrects the bubble position even if no scroll event ever fires', () => {
    // 실제로 겪은 버그: 컨플루언스 내부 스크롤 컨테이너 구조에 따라 scrollIntoView가 끝나도
    // 우리가 잡을 수 있는 'scroll' 이벤트가 안 날 수 있다 — 그러면 말풍선이 클릭 시점(스크롤
    // 전, 옛 위치)에 영영 고정된다. scroll 이벤트에 의존하지 않는 rAF 기반 재계산이 이걸 잡는다.
    vi.useFakeTimers()
    try {
      applyIssueOverlay([ISSUE])
      const mark = document.querySelector<HTMLElement>('.sunnic-issue-highlight')
      if (!mark) throw new Error('mark not found')
      mark.scrollIntoView = vi.fn()
      mark.getBoundingClientRect = vi.fn().mockReturnValue({ top: 5, bottom: 20, left: 2, right: 90 } as DOMRect)

      scrollToIssue(ISSUE.id)
      const tooltip = document.querySelector<HTMLElement>('.sunnic-issue-tooltip')
      expect(tooltip?.style.top).toBe('26px')

      // scroll settles somewhere else, but no 'scroll' event is ever dispatched.
      mark.getBoundingClientRect = vi.fn().mockReturnValue({ top: 500, bottom: 520, left: 10, right: 100 } as DOMRect)
      vi.advanceTimersByTime(800)

      expect(tooltip?.style.top).toBe('526px')
    } finally {
      vi.useRealTimers()
    }
  })
})
