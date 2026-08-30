import type { IssueResponse } from '../api/types'
import type { IssueEdit } from './types'

const DONE_ACTIONS = new Set(['apply', 'edit'])

export interface SuggestionProgress {
  done: number
  skipped: number
  total: number
}

export function deriveProgress(issues: IssueResponse[], issueEdits: Record<string, IssueEdit>): SuggestionProgress {
  let done = 0
  let skipped = 0
  for (const issue of issues) {
    const action = issueEdits[issue.id]?.action
    if (action && DONE_ACTIONS.has(action)) done += 1
    else if (action === 'skip') skipped += 1
  }
  return { done, skipped, total: issues.length }
}

// 아직 완료/건너뜀 처리가 안 된 이슈만, 원래(위치) 순서 그대로 반환한다 — 소스(팀/기본)별로 묶지
// 않는다: 실제 .dc.html 레퍼런스도 README의 "그룹핑" 설명과 달리 뒤섞인 순서로 카드를 보여준다.
export function getOpenIssues(issues: IssueResponse[], issueEdits: Record<string, IssueEdit>): IssueResponse[] {
  return issues.filter((issue) => issueEdits[issue.id] === undefined)
}

// afterId 다음에 오는 첫 미해결 이슈 id — "수정 완료로 표시"/"건너뛰기" 후 자동으로 다음 제안으로
// 넘어가는 데 쓴다. afterId 이후에 없으면 처음부터 다시 훑어서 앞쪽에 남은 미해결 이슈를 찾고,
// 그마저 없으면 null(= 3d 완료 요약으로 이동해야 한다는 신호).
export function getNextOpenIssueId(
  issues: IssueResponse[],
  issueEdits: Record<string, IssueEdit>,
  afterId: string,
): string | null {
  const afterIndex = issues.findIndex((issue) => issue.id === afterId)
  const open = getOpenIssues(issues, issueEdits)
  if (open.length === 0) return null

  const nextAfter = issues.slice(afterIndex + 1).find((issue) => issueEdits[issue.id] === undefined)
  return nextAfter?.id ?? open[0].id
}
