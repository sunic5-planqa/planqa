import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractPageId, navigateToEditMode, parseParentInfo, parseSiblingPages } from './confluence-extractor'

describe('extractPageId', () => {
  it('extracts the id from the modern /pages/{id}/{title} path', () => {
    const url = 'https://example.atlassian.net/wiki/spaces/PLAN/pages/123456789/기획서'

    expect(extractPageId(url)).toBe('123456789')
  })

  it('extracts the id from the legacy ?pageId= query param', () => {
    const url = 'https://example.atlassian.net/wiki/pages/viewpage.action?pageId=987654321'

    expect(extractPageId(url)).toBe('987654321')
  })

  it('extracts the id from the new editor\'s draft path ("/pages/edit-v2/{id}")', () => {
    // 실사용자가 겪은 버그: 새 편집기 초안 URL은 "pages/" 뒤에 "edit-v2/"가 한 단계 더 끼어들어서
    // 숫자가 바로 안 나온다 — 도메인은 *.atlassian.net으로 맞는데도 "컨플루언스 페이지가 아님"으로
    // 잘못 판정됐다.
    const url = 'https://playonejr.atlassian.net/wiki/spaces/~712020b/pages/edit-v2/294914?draftShareId=abc'

    expect(extractPageId(url)).toBe('294914')
  })

  it('returns null for a non-Confluence URL', () => {
    expect(extractPageId('https://www.google.com')).toBeNull()
  })
})

describe('navigateToEditMode', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('navigates the tab to the edit-v2 URL for the current page', () => {
    vi.stubGlobal('location', {
      href: 'https://example.atlassian.net/wiki/spaces/PLAN/pages/123456789/기획서',
      origin: 'https://example.atlassian.net',
    })

    const result = navigateToEditMode()

    expect(result).toEqual({ ok: true })
    expect(location.href).toBe('https://example.atlassian.net/wiki/pages/edit-v2/123456789')
  })

  it('returns NOT_A_CONFLUENCE_PAGE without touching the URL when there is no page id', () => {
    vi.stubGlobal('location', { href: 'https://www.google.com', origin: 'https://www.google.com' })

    const result = navigateToEditMode()

    expect(result).toEqual({ ok: false, error: 'NOT_A_CONFLUENCE_PAGE' })
    expect(location.href).toBe('https://www.google.com')
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
