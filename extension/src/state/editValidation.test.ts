import { describe, expect, it } from 'vitest'
import { similarityRatio, validateEdit } from './editValidation'

describe('similarityRatio', () => {
  it('returns 1 for identical strings', () => {
    expect(similarityRatio('동해물', '동해물')).toBe(1)
  })

  it('returns 1 for two empty strings', () => {
    expect(similarityRatio('', '')).toBe(1)
  })

  it('returns a low ratio for completely different strings', () => {
    expect(similarityRatio('동해물', 'xyz')).toBeLessThan(0.3)
  })

  it('returns a high ratio for a one-character edit', () => {
    expect(similarityRatio('동해물', '동해뭉')).toBeGreaterThan(0.6)
  })
})

describe('validateEdit', () => {
  const issue = { input_text: '동해의 바다', suggestion: '동해물' }

  it('flags the issue as unresolved when the edited text still contains the original phrase', () => {
    const result = validateEdit(issue, '동해의 바다는 아름답다')
    expect(result.issueLikelyResolved).toBe(false)
  })

  it('treats the issue as resolved when the original phrase is gone', () => {
    const result = validateEdit(issue, '동해물')
    expect(result.issueLikelyResolved).toBe(true)
  })

  it('treats the issue as resolved when input_text is blank', () => {
    const result = validateEdit({ input_text: '  ', suggestion: '동해물' }, '아무 문장')
    expect(result.issueLikelyResolved).toBe(true)
  })

  it('reports low similarity when the edit diverges far from the suggestion', () => {
    const result = validateEdit(issue, '완전히 다른 문장입니다')
    expect(result.matchesSuggestionClosely).toBe(false)
  })

  it('reports high similarity when the edit matches the suggestion exactly', () => {
    const result = validateEdit(issue, '동해물')
    expect(result.matchesSuggestionClosely).toBe(true)
  })
})
