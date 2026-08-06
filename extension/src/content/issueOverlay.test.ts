import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyIssueOverlay, clearIssueOverlay } from './issueOverlay'
import type { OverlayIssue } from './messages'

const ISSUE: OverlayIssue = {
  id: 'issue-1',
  input_text: '3사만 지원, 페이코 미지원',
  criteria: '용어 및 단어의 일관성',
  reason: '테스트용 이유',
  suggestion: '4사만 지원, 페이코 미지원',
}

const PAGE_HTML = '<p>간편결제(카카오페이, 네이버페이, 토스) 3사만 지원, 페이코 미지원 안내.</p>'

function stubConfluenceFetch(overrides?: { getBody?: string; getOk?: boolean; putOk?: boolean }): ReturnType<typeof vi.fn> {
  const getOk = overrides?.getOk ?? true
  const putOk = overrides?.putOk ?? true
  const body = overrides?.getBody ?? PAGE_HTML

  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      return new Response(JSON.stringify({ ok: true }), { status: putOk ? 200 : 500 })
    }
    return new Response(
      JSON.stringify({ title: 'PRD', version: { number: 4 }, body: { storage: { value: body } } }),
      { status: getOk ? 200 : 500 },
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
  ;(window as unknown as HappyDomWindow).happyDOM.setURL('http://localhost:8000/mock-confluence/pages/482910')
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

  it('clicking the highlight then the fix button saves to Confluence and marks it resolved', async () => {
    const fetchMock = stubConfluenceFetch()
    applyIssueOverlay([ISSUE])
    const mark = document.querySelector<HTMLElement>('.sunnic-issue-highlight')
    mark?.click()

    const button = document.querySelector<HTMLButtonElement>('.sunnic-issue-tooltip button')
    expect(button).not.toBeNull()
    button?.click()

    await vi.waitFor(() => expect(mark?.classList.contains('sunnic-issue-resolved')).toBe(true))

    expect(mark?.textContent).toBe(ISSUE.suggestion)
    expect(document.querySelector('.sunnic-issue-tooltip')).toBeNull()
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'ISSUE_OVERLAY_RESOLVED',
      issueId: ISSUE.id,
      editedText: ISSUE.suggestion,
    })

    const putCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')
    expect(putCall).toBeDefined()
    const putBody = JSON.parse((putCall?.[1] as RequestInit).body as string) as { body: { storage: { value: string } } }
    expect(putBody.body.storage.value).toContain(ISSUE.suggestion)
  })

  it('shows an inline error and re-enables the button when the original text is missing from Confluence', async () => {
    stubConfluenceFetch({ getBody: '<p>완전히 다른 본문</p>' })
    applyIssueOverlay([ISSUE])
    const mark = document.querySelector<HTMLElement>('.sunnic-issue-highlight')
    mark?.click()
    document.querySelector<HTMLButtonElement>('.sunnic-issue-tooltip button')?.click()

    await vi.waitFor(() => expect(document.querySelector('.sunnic-tooltip-error')).not.toBeNull())

    expect(mark?.classList.contains('sunnic-issue-resolved')).toBe(false)
    const button = document.querySelector<HTMLButtonElement>('.sunnic-issue-tooltip button')
    expect(button?.disabled).toBe(false)
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled()
  })

  it('shows an inline error when the PUT request fails', async () => {
    stubConfluenceFetch({ putOk: false })
    applyIssueOverlay([ISSUE])
    document.querySelector<HTMLElement>('.sunnic-issue-highlight')?.click()
    document.querySelector<HTMLButtonElement>('.sunnic-issue-tooltip button')?.click()

    await vi.waitFor(() => expect(document.querySelector('.sunnic-tooltip-error')).not.toBeNull())

    expect(document.querySelector('.sunnic-issue-highlight')?.classList.contains('sunnic-issue-resolved')).toBe(false)
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
