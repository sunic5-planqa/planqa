import { describe, expect, it } from 'vitest'
import type { NumberingIssueResponse } from '../api/types'
import { numberingIssueToScrollLocation } from './numberingLocation'

function numberingIssue(overrides: Partial<NumberingIssueResponse> = {}): NumberingIssueResponse {
  return {
    id: 'n1',
    status: 'auto',
    sub_type: 'duplicate',
    location: '2. 발송 정책 > 2-2. 발송 채널',
    problem: '번호 중복',
    before_text: '2-2. 발송 채널',
    after_text: '2-3. 발송 채널',
    ...overrides,
  }
}

describe('numberingIssueToScrollLocation', () => {
  it('uses the current (wrong) heading text as the match target and the chain as the fallback', () => {
    expect(numberingIssueToScrollLocation(numberingIssue())).toEqual({
      text: '2-2. 발송 채널',
      location: '2. 발송 정책 > 2-2. 발송 채널',
    })
  })

  it('carries before_text through even when there is no after_text (ambiguous case)', () => {
    const loc = numberingIssueToScrollLocation(numberingIssue({ after_text: null, status: 'confirm', sub_type: 'ambiguous' }))
    expect(loc.text).toBe('2-2. 발송 채널')
  })
})
