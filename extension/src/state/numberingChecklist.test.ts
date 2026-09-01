import { describe, expect, it } from 'vitest'
import type { NumberingIssueResponse } from '../api/types'
import { deriveDefaultChecked } from './numberingChecklist'

function numberingIssue(overrides: Partial<NumberingIssueResponse> = {}): NumberingIssueResponse {
  return {
    id: 'n1',
    status: 'auto',
    sub_type: 'missing',
    location: '3. 해결 방안',
    problem: '번호 누락',
    before_text: '4. 해결 방안',
    after_text: '3. 해결 방안',
    ...overrides,
  }
}

describe('deriveDefaultChecked', () => {
  it('checks auto-fixable issues by default', () => {
    const issues = [numberingIssue({ id: 'a', status: 'auto' })]

    expect(deriveDefaultChecked(issues)).toEqual(new Set(['a']))
  })

  it('does not check confirm-needed issues by default', () => {
    const issues = [numberingIssue({ id: 'a', status: 'confirm', sub_type: 'ambiguous', after_text: null })]

    expect(deriveDefaultChecked(issues)).toEqual(new Set())
  })

  it('mixes auto and confirm issues correctly', () => {
    const issues = [
      numberingIssue({ id: 'a', status: 'auto' }),
      numberingIssue({ id: 'b', status: 'confirm', sub_type: 'ambiguous', after_text: null }),
      numberingIssue({ id: 'c', status: 'auto' }),
    ]

    expect(deriveDefaultChecked(issues)).toEqual(new Set(['a', 'c']))
  })
})
