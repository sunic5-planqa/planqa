import { OverviewPanel } from '../issues/OverviewPanel'
import { api } from '../../api/client'
import { NotImplementedError } from '../../api/errors'
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

  const stageDecision = async (action: 'apply' | 'skip') => {
    dispatch({ type: 'STAGE_ISSUE_EDIT', issueId: issue.id, action })
    try {
      await api.updateIssue(issue.id, { action })
    } catch (err) {
      if (!(err instanceof NotImplementedError)) {
        dispatch({ type: 'SET_ERROR', error: err instanceof Error ? err.message : String(err) })
      }
    }
  }

  return (
    <div className="screen issue-list-screen">
      <h1>AI QA Service</h1>

      <OverviewPanel issues={issues} />

      <p className="issue-error-count">
        문서 오류 <strong>{remainingCount}</strong>개
      </p>
      <p className="hint">
        {currentIssueIndex + 1} / {issues.length}
      </p>

      <dl className="issue-details">
        <dt>위치</dt>
        <dd>{issue.location}</dd>
        <dt>입력 내용</dt>
        <dd>{issue.input_text}</dd>
        <dt>검증 기준</dt>
        <dd>{issue.criteria}</dd>
        <dt>검증 이유</dt>
        <dd>{issue.reason}</dd>
        <dt>대치 제안</dt>
        <dd>
          {issue.suggestion}
          {isResolved && <span className="resolved-badge">✓ 수정완료</span>}
        </dd>
      </dl>

      <div className="issue-actions">
        <Button variant="primary" onClick={() => void stageDecision('apply')}>
          적용
        </Button>
        <Button variant="secondary" onClick={() => void stageDecision('skip')}>
          스킵
        </Button>
        <Button variant="secondary" onClick={() => dispatch({ type: 'NAVIGATE', screen: 'edit' })}>
          수정하기
        </Button>
      </div>

      <div className="issue-nav">
        <Button
          variant="secondary"
          disabled={currentIssueIndex === 0}
          onClick={() => dispatch({ type: 'NAVIGATE_ISSUE', direction: 'prev' })}
        >
          이전
        </Button>
        {currentIssueIndex === issues.length - 1 ? (
          <Button onClick={() => dispatch({ type: 'NAVIGATE', screen: 'history' })}>QA 완료 ▶</Button>
        ) : (
          <Button variant="secondary" onClick={() => dispatch({ type: 'NAVIGATE_ISSUE', direction: 'next' })}>
            다음
          </Button>
        )}
      </div>
    </div>
  )
}
