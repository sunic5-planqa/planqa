import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractPageId, navigateToEditMode, openReferenceDocument, parseParentInfo, parseSiblingPages } from './confluence-extractor'
import { REFERENCE_SCROLL_LOCATION_PARAM, REFERENCE_SCROLL_TEXT_PARAM } from './referenceScrollParams'

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

describe('openReferenceDocument', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // 참고문서는 다른 페이지라 이 탭 안에서 스크롤할 방법이 없다 — 새 탭이 로드 후 스스로 그
  // 위치로 스크롤하도록(issueOverlay.ts), 어디로 가야 하는지를 새 탭 URL의 쿼리 파라미터에
  // 실어 보내야 한다.
  it('opens the legacy pageId URL carrying the target location as query params', () => {
    vi.stubGlobal('location', { origin: 'https://example.atlassian.net' })
    const openSpy = vi.fn()
    vi.stubGlobal('open', openSpy)

    const result = openReferenceDocument('987654321', { text: '월 1회로 제한한다', location: '3-2. 이용 제한' })

    expect(result).toEqual({ ok: true })
    expect(openSpy).toHaveBeenCalledTimes(1)
    const [url, target, features] = openSpy.mock.calls[0]
    expect(target).toBe('_blank')
    expect(features).toBe('noopener')
    const parsed = new URL(url)
    expect(parsed.origin).toBe('https://example.atlassian.net')
    expect(parsed.pathname).toBe('/wiki/pages/viewpage.action')
    expect(parsed.searchParams.get('pageId')).toBe('987654321')
    expect(parsed.searchParams.get(REFERENCE_SCROLL_TEXT_PARAM)).toBe('월 1회로 제한한다')
    expect(parsed.searchParams.get(REFERENCE_SCROLL_LOCATION_PARAM)).toBe('3-2. 이용 제한')
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
