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

  // 새 편집기 URL은 스페이스 키가 있어야 404가 안 난다("/wiki/pages/edit-v2/{id}"만으로는 실사용
  // 중 "문제가 발생했습니다" 404를 실제로 만남) — 이동 전에 그 페이지의 스페이스 키를 REST로
  // 조회해서 "/wiki/spaces/{키}/pages/edit-v2/{id}"를 만든다.
  it('looks up the space key and navigates to the space-scoped edit-v2 URL', async () => {
    vi.stubGlobal('location', {
      href: 'https://example.atlassian.net/wiki/spaces/PLAN/pages/123456789/기획서',
      origin: 'https://example.atlassian.net',
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ space: { key: 'PLAN' } }), { status: 200 })),
    )

    const result = await navigateToEditMode()

    expect(result).toEqual({ ok: true })
    expect(location.href).toBe('https://example.atlassian.net/wiki/spaces/PLAN/pages/edit-v2/123456789')
  })

  it('returns NOT_A_CONFLUENCE_PAGE without touching the URL when there is no page id', async () => {
    vi.stubGlobal('location', { href: 'https://www.google.com', origin: 'https://www.google.com' })

    const result = await navigateToEditMode()

    expect(result).toEqual({ ok: false, error: 'NOT_A_CONFLUENCE_PAGE' })
    expect(location.href).toBe('https://www.google.com')
  })

  it('returns FETCH_FAILED without touching the URL when the space lookup fails', async () => {
    vi.stubGlobal('location', {
      href: 'https://example.atlassian.net/wiki/spaces/PLAN/pages/123456789/기획서',
      origin: 'https://example.atlassian.net',
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 404 })),
    )

    const result = await navigateToEditMode()

    expect(result).toEqual({ ok: false, error: 'FETCH_FAILED', detail: '404' })
    expect(location.href).toBe('https://example.atlassian.net/wiki/spaces/PLAN/pages/123456789/기획서')
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
