import { describe, expect, it } from 'vitest'
import { isIssueLikelyResolved } from './editValidation'

describe('isIssueLikelyResolved', () => {
  it('flags the issue as unresolved when the edited text still contains the original phrase', () => {
    expect(isIssueLikelyResolved('동해의 바다', '동해의 바다는 아름답다')).toBe(false)
  })

  it('treats the issue as resolved when the original phrase is gone', () => {
    expect(isIssueLikelyResolved('동해의 바다', '동해물')).toBe(true)
  })

  it('treats the issue as resolved when input_text is blank', () => {
    expect(isIssueLikelyResolved('  ', '아무 문장')).toBe(true)
  })
})
