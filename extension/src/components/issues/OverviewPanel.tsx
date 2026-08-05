import { useState } from 'react'
import type { IssueResponse } from '../../api/types'
import { groupIssuesByCriteria } from '../../state/issueGrouping'

export function OverviewPanel({ issues }: { issues: IssueResponse[] }) {
  const groups = groupIssuesByCriteria(issues)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(groups.map((g) => g.criteria)))

  const toggle = (criteria: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(criteria)) next.delete(criteria)
      else next.add(criteria)
      return next
    })
  }

  if (groups.length === 0) return null

  return (
    <div className="overview-panel">
      <h2>Overview</h2>
      {groups.map((group) => (
        <div key={group.criteria} className="overview-group">
          <button type="button" className="overview-group-toggle" onClick={() => toggle(group.criteria)}>
            {expanded.has(group.criteria) ? '▼' : '▶'} {group.criteria}
          </button>
          {!expanded.has(group.criteria) && <p className="hint">{group.issues[0].reason}</p>}
          {expanded.has(group.criteria) && (
            <ul className="overview-issue-list">
              {group.issues.map((issue) => (
                <li key={issue.id}>{issue.location}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  )
}
