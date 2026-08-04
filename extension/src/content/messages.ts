export interface ExtractConfluenceContentRequest {
  type: 'EXTRACT_CONFLUENCE_CONTENT'
}

export type ExtractConfluenceContentResponse =
  | { ok: true; markdown: string; title: string }
  | { ok: false; error: 'NOT_A_CONFLUENCE_PAGE' | 'FETCH_FAILED'; detail?: string }
