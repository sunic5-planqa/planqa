import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendExtractRequest } from './useConfluenceAutoDetect'

// 새로고침 직후엔 content script가 아직 리스너를 등록하기 전이라 sendMessage가 "연결할 수 없음"으로
// 실패할 수 있다 — 실사용자가 탭 새로고침 직후 확장프로그램을 열어서 "컨플루언스 페이지가
// 아닙니다"를 실제로 만난 버그(2026-09-12)의 회귀 테스트.
describe('sendExtractRequest', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the response immediately when the content script is already listening', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true, markdown: 'x', title: 't', pageId: '1' })
    vi.stubGlobal('chrome', { tabs: { sendMessage } })

    const result = await sendExtractRequest(42, 5)

    expect(result).toEqual({ ok: true, markdown: 'x', title: 't', pageId: '1' })
    expect(sendMessage).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })

  it('retries after a connection failure and succeeds once the content script is ready', async () => {
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error('Could not establish connection'))
      .mockRejectedValueOnce(new Error('Could not establish connection'))
      .mockResolvedValueOnce({ ok: true, markdown: 'x', title: 't', pageId: '1' })
    vi.stubGlobal('chrome', { tabs: { sendMessage } })

    const promise = sendExtractRequest(42, 5)
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result).toEqual({ ok: true, markdown: 'x', title: 't', pageId: '1' })
    expect(sendMessage).toHaveBeenCalledTimes(3)
    vi.unstubAllGlobals()
  })

  it('gives up and rethrows once retries are exhausted', async () => {
    const connectionError = new Error('Could not establish connection')
    const sendMessage = vi.fn().mockRejectedValue(connectionError)
    vi.stubGlobal('chrome', { tabs: { sendMessage } })

    // rejects 핸들러를 타이머 진행 전에 먼저 붙여야 한다 — 안 그러면 fake timer가 reject를
    // 흘려보내는 그 짧은 틈에 아무도 안 붙잡은 상태가 되어 vitest가 unhandled rejection으로
    // 잡아버린다(테스트 자체는 통과하지만 노이즈가 남는다).
    const promise = sendExtractRequest(42, 2)
    const assertion = expect(promise).rejects.toBe(connectionError)
    await vi.runAllTimersAsync()
    await assertion
    expect(sendMessage).toHaveBeenCalledTimes(3) // 최초 1회 + 재시도 2회
    vi.unstubAllGlobals()
  })
})
