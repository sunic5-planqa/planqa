export interface ExtractConfluenceContentRequest {
  type: 'EXTRACT_CONFLUENCE_CONTENT'
}

export type ExtractConfluenceContentResponse =
  | { ok: true; markdown: string; title: string }
  | { ok: false; error: 'NOT_A_CONFLUENCE_PAGE' | 'FETCH_FAILED'; detail?: string }

export interface ListSiblingPagesRequest {
  type: 'LIST_SIBLING_PAGES'
}

export type ListSiblingPagesResponse =
  | { ok: true; siblings: { id: string; title: string }[] }
  | { ok: false; error: 'NOT_A_CONFLUENCE_PAGE' | 'NO_PARENT' | 'FETCH_FAILED'; detail?: string }

export interface FetchPageMarkdownRequest {
  type: 'FETCH_PAGE_MARKDOWN'
  pageId: string
}

export type FetchPageMarkdownResponse =
  | { ok: true; markdown: string; title: string }
  | { ok: false; error: 'FETCH_FAILED'; detail?: string }
