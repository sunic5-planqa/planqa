import { OverviewPanel } from '../issues/OverviewPanel'
import { useAppDispatch, useAppState } from '../../state/hooks'
import { Button } from '../common/Button'

const RESOLVED_ACTIONS = new Set(['apply', 'edit'])

export function IssueListScreen() {
  const { issues, currentIssueIndex, issueEdits } = useAppState()
  const dispatch = useAppDispatch()

  const resolvedCount = issues.filter((i) => RESOLVED_ACTIONS.has(issueEdits[i.id]?.action ?? '')).length
  const remainingCount = issues.length - resolvedCount

  const issue = issues[currentIssueIndex]
  if (!issue) {
    return (
      <div className="screen issue-list-screen">
        <p>발견된 이슈가 없습니다.</p>
        <Button onClick={() => dispatch({ type: 'NAVIGATE', screen: 'history' })}>다음</Button>
      </div>
    )
  }

  const isResolved = RESOLVED_ACTIONS.has(issueEdits[issue.id]?.action ?? '')
  const suggestion = issueEdits[issue.id]?.editedText ?? issue.suggestion

  return (
    <div className="screen issue-list-screen">
      <div className="screen-scroll">
        <h1 className="panel-title">AI QA Service</h1>
        <hr className="panel-divider" />

        <OverviewPanel issues={issues} currentIssueId={issue.id} />

        <p className="issue-error-count">
          문서 오류 <strong>{remainingCount}</strong>개
        </p>

        <div className="issue-detail-card">
          <div className="issue-detail-block">
            <span className="issue-detail-label">입력내용</span>
            <p className="issue-detail-value">{issue.input_text}</p>
          </div>

          <div className="issue-detail-block">
            <div className="issue-suggestion-row">
              <span className="issue-detail-label">수정제안</span>
              {isResolved ? (
                <span className="resolved-badge">✓ 수정완료</span>
              ) : (
                <button type="button" className="issue-fix-link" onClick={() => dispatch({ type: 'NAVIGATE', screen: 'edit' })}>
                  오류 수정하기 ✏️
                </button>
              )}
            </div>
            <p className="issue-suggestion-text">{suggestion}</p>
          </div>

          <hr className="issue-detail-divider" />

          <div className="issue-detail-block">
            <span className="issue-detail-label">검증기준</span>
            <span className="issue-criteria-badge">{issue.criteria}</span>
          </div>

          <div className="issue-detail-block">
            <span className="issue-detail-label">검증이유</span>
            <p className="issue-reason-text">{issue.reason}</p>
          </div>
        </div>

        <div className="issue-nav">
          <button
            type="button"
            className="issue-nav-prev"
            disabled={currentIssueIndex === 0}
            onClick={() => dispatch({ type: 'NAVIGATE_ISSUE', direction: 'prev' })}
          >
            {'< 이전'}
          </button>
          {currentIssueIndex < issues.length - 1 && (
            <button type="button" className="issue-nav-next" onClick={() => dispatch({ type: 'NAVIGATE_ISSUE', direction: 'next' })}>
              {'다음 >'}
            </button>
          )}
        </div>
      </div>

      <div className="screen-footer">
        <Button className="btn-cta" onClick={() => dispatch({ type: 'NAVIGATE', screen: 'history' })}>
          QA 완료
        </Button>
      </div>
    </div>
  )
}
