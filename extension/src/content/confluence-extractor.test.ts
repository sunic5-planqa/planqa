import { describe, expect, it } from 'vitest'
import { extractPageId, parseParentInfo, parseSiblingPages } from './confluence-extractor'

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

describe('parseParentInfo', () => {
  it('returns the last ancestor as the immediate parent', () => {
    const data = {
      ancestors: [
        { id: '1', title: '루트' },
        { id: '2', title: '중간' },
        { id: '229548', title: '기획서 더미 문서함' },
      ],
    }

    expect(parseParentInfo(data)).toEqual({ id: '229548', title: '기획서 더미 문서함' })
  })

  it('returns null when the page has no ancestors (top-level page)', () => {
    expect(parseParentInfo({ ancestors: [] })).toBeNull()
  })
})

describe('parseSiblingPages', () => {
  it('excludes the current page and maps to id/title pairs', () => {
    const data = {
      results: [
        { id: '229548', title: 'DOC-001' },
        { id: '229549', title: 'DOC-002' },
        { id: '229550', title: 'DOC-003' },
      ],
    }

    expect(parseSiblingPages(data, '229548')).toEqual([
      { id: '229549', title: 'DOC-002' },
      { id: '229550', title: 'DOC-003' },
    ])
  })

  it('returns an empty list when there are no other children', () => {
    const data = { results: [{ id: '229548', title: 'DOC-001' }] }

    expect(parseSiblingPages(data, '229548')).toEqual([])
  })
})
