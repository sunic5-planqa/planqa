import type { IssueResponse } from '../../api/types'
import { useAppDispatch } from '../../state/hooks'
import { groupIssuesByCriteria } from '../../state/issueGrouping'

export function OverviewPanel({ issues, currentIssueId }: { issues: IssueResponse[]; currentIssueId: string | undefined }) {
  const dispatch = useAppDispatch()
  const groups = groupIssuesByCriteria(issues)
  const activeCriteria = issues.find((issue) => issue.id === currentIssueId)?.criteria

  if (groups.length === 0) return null

  return (
    <div className="overview-panel">
      <h2 className="overview-heading">Overview</h2>
      {groups.map((group) => {
        const active = group.criteria === activeCriteria
        return (
          <button
            key={group.criteria}
            type="button"
            className={`overview-card ${active ? 'overview-card-active' : ''}`.trim()}
            onClick={() => dispatch({ type: 'SELECT_ISSUE_BY_ID', issueId: group.issues[0].id })}
          >
            <div className="overview-card-row">
              <span className="overview-card-title">{group.criteria}</span>
              <span className="overview-card-chevron">{active ? '▾' : '▸'}</span>
            </div>
            <p className="overview-card-preview">&ldquo;{group.issues[0].input_text}&rdquo;</p>
          </button>
        )
      })}
    </div>
  )
}
