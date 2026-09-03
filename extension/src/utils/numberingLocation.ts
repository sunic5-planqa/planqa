import type { NumberingIssueResponse } from '../api/types'
import type { SuggestionLocation } from '../content/messages'

// 넘버링 수정 내역도 일반 QA 이슈와 똑같이 문서 위치로 점프할 수 있어야 한다 — content script의
// SCROLL_TO_LOCATION 핸들러(issueOverlay.scrollToLocation)는 { text, location }을 받아 본문에서
// text를 찾고, 못 찾으면 location 체인의 leaf 제목(h2~h6)으로 폴백한다. 넘버링 이슈의
// before_text는 현재 문서에 실제로 박혀 있는 (틀린) 헤딩 문구라 그대로 text로 쓰면 되고,
// location은 "상위 > 하위" 체인이라 폴백 키로도 쓸 수 있다.
export function numberingIssueToScrollLocation(issue: NumberingIssueResponse): SuggestionLocation {
  return { text: issue.before_text, location: issue.location }
}
