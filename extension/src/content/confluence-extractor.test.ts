import { describe, expect, it } from 'vitest'
import { extractPageId } from './confluence-extractor'

describe('extractPageId', () => {
  it('extracts the id from the modern /pages/{id}/{title} path', () => {
    const url = 'https://example.atlassian.net/wiki/spaces/PLAN/pages/123456789/기획서'

    expect(extractPageId(url)).toBe('123456789')
  })

  it('extracts the id from the legacy ?pageId= query param', () => {
    const url = 'https://example.atlassian.net/wiki/pages/viewpage.action?pageId=987654321'

    expect(extractPageId(url)).toBe('987654321')
  })

  it('returns null for a non-Confluence URL', () => {
    expect(extractPageId('https://www.google.com')).toBeNull()
  })
})
