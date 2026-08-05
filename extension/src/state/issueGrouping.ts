import type { IssueResponse } from '../api/types'

export interface IssueGroup {
  criteria: string
  issues: IssueResponse[]
}

export function groupIssuesByCriteria(issues: IssueResponse[]): IssueGroup[] {
  const groups = new Map<string, IssueResponse[]>()

  for (const issue of issues) {
    const existing = groups.get(issue.criteria)
    if (existing) existing.push(issue)
    else groups.set(issue.criteria, [issue])
  }

  return Array.from(groups.entries()).map(([criteria, groupIssues]) => ({ criteria, issues: groupIssues }))
}
