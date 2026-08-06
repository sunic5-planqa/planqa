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

beforeEach(() => {
  document.body.innerHTML = '<main><p>간편결제(카카오페이, 네이버페이, 토스) 3사만 지원, 페이코 미지원 안내.</p></main>'
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

  it('clicking the highlight then the fix button replaces the text and marks it resolved', () => {
    applyIssueOverlay([ISSUE])
    const mark = document.querySelector<HTMLElement>('.sunnic-issue-highlight')
    mark?.click()

    const button = document.querySelector<HTMLButtonElement>('.sunnic-issue-tooltip button')
    expect(button).not.toBeNull()
    button?.click()

    expect(mark?.textContent).toBe(ISSUE.suggestion)
    expect(mark?.classList.contains('sunnic-issue-resolved')).toBe(true)
    expect(document.querySelector('.sunnic-issue-tooltip')).toBeNull()
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'ISSUE_OVERLAY_RESOLVED',
      issueId: ISSUE.id,
      editedText: ISSUE.suggestion,
    })
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
