import { beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetDuplicateSessionForTests, applyIssueEdit, applyIssueOverlay, clearIssueOverlay } from './issueOverlay'
import type { OverlayIssue } from './messages'

const ISSUE: OverlayIssue = {
  id: 'issue-1',
  input_text: '3사만 지원, 페이코 미지원',
  criteria: '용어 및 단어의 일관성',
  reason: '테스트용 이유',
  suggestion: '4사만 지원, 페이코 미지원',
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
})
