import { htmlToChapterMarkdown } from './confluenceParser'
import type { ExtractConfluenceContentRequest, ExtractConfluenceContentResponse } from './messages'

export function extractPageId(url: string): string | null {
  const pathMatch = url.match(/\/pages\/(\d+)/)
  if (pathMatch) return pathMatch[1]

  const queryMatch = url.match(/[?&]pageId=(\d+)/)
  if (queryMatch) return queryMatch[1]

  return null
}

interface ConfluenceContentResponse {
  title: string
  body: { storage: { value: string } }
}

async function extractCurrentPage(): Promise<ExtractConfluenceContentResponse> {
  const pageId = extractPageId(location.href)
  if (!pageId) return { ok: false, error: 'NOT_A_CONFLUENCE_PAGE' }

  try {
    const res = await fetch(`${location.origin}/wiki/rest/api/content/${pageId}?expand=body.storage`, {
      credentials: 'include',
    })
    if (!res.ok) return { ok: false, error: 'FETCH_FAILED', detail: `${res.status}` }

    const data = (await res.json()) as ConfluenceContentResponse
    return { ok: true, markdown: htmlToChapterMarkdown(data.title, data.body.storage.value) }
  } catch (err) {
    return { ok: false, error: 'FETCH_FAILED', detail: String(err) }
  }
}

chrome.runtime.onMessage.addListener(
  (message: ExtractConfluenceContentRequest, _sender, sendResponse: (response: ExtractConfluenceContentResponse) => void) => {
    if (message.type !== 'EXTRACT_CONFLUENCE_CONTENT') return

    void extractCurrentPage().then(sendResponse)
    return true
  },
)
