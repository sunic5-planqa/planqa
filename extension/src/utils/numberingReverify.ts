import { api } from '../api/client'
import type { NumberingIssueResponse } from '../api/types'
import type { FetchPageMarkdownRequest, FetchPageMarkdownResponse } from '../content/messages'

// 번호 재검증은 항상 "지금 실제로 저장된" 라이브 페이지를 다시 읽어서 해야 한다 — 백엔드가 따로
// 들고 있는 사본을 로컬로 패치해 재검증하면 실제 저장 내용과 어긋날 수 있고, 그 어긋난 목록을 또
// 적용하면 이미 고친 부분을 엉뚱하게 덮어쓴다(실사용 버그, 2026-10-01). pageId는 호출부가 직접
// 방금 저장이 실제로 성공한 "살아있는" 값을 넘겨야 한다 — AppState의 캐싱된 confluencePageId를
// 그대로 쓰면 탭이 다른 페이지로 이동했을 때 엉뚱한 문서를 재검증하게 된다. 라이브 조회 자체가
// 실패하면(탭이 닫혔거나 응답이 안 옴) null을 돌려준다 — 실패 시 어떻게 대응할지(에러로 막을지,
// 뭔가로 폴백할지)는 화면마다 다르므로 호출부가 결정한다.
export async function fetchLiveNumberingIssues(
  confluenceTabId: number,
  pageId: string,
  jobId: string,
): Promise<NumberingIssueResponse[] | null> {
  let pageResponse: FetchPageMarkdownResponse
  try {
    pageResponse = await chrome.tabs.sendMessage<FetchPageMarkdownRequest, FetchPageMarkdownResponse>(
      confluenceTabId,
      { type: 'FETCH_PAGE_MARKDOWN', pageId, preserveHeadingLevels: true },
    )
  } catch {
    return null
  }
  if (!pageResponse.ok) return null
  return api.getNumberingIssues(jobId, pageResponse.markdown)
}
