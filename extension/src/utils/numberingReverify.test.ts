import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchLiveNumberingIssues } from './numberingReverify'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchLiveNumberingIssues', () => {
  it('fetches live markdown from the given tab/page and re-validates it against the backend', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true, markdown: '# 기획서\n## 1. 개요', title: 't' })
    vi.stubGlobal('chrome', { tabs: { sendMessage } })
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: '1' }]), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchLiveNumberingIssues(42, 'page-1', 'job-1')

    expect(sendMessage).toHaveBeenCalledWith(42, {
      type: 'FETCH_PAGE_MARKDOWN',
      pageId: 'page-1',
      preserveHeadingLevels: true,
    })
    expect(result).toEqual([{ id: '1' }])
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ raw_text: '# 기획서\n## 1. 개요' })
  })

  // 실사용 버그(코드 리뷰로 확인): 라이브 재조회가 실패했을 때 조용히 예전 값을 쓰거나 throw해서
  // 호출부가 못 알아채면 안 된다 — null을 돌려줘서 호출부가 명시적으로 처리하게 한다.
  it('returns null when the content script cannot fetch the live page', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: false, error: 'FETCH_FAILED' })
    vi.stubGlobal('chrome', { tabs: { sendMessage } })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchLiveNumberingIssues(42, 'page-1', 'job-1')

    expect(result).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns null when the document tab is unreachable', async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error('Could not establish connection'))
    vi.stubGlobal('chrome', { tabs: { sendMessage } })

    const result = await fetchLiveNumberingIssues(42, 'page-1', 'job-1')

    expect(result).toBeNull()
  })
})
