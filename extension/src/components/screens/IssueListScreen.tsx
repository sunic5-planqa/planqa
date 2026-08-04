import { api } from '../../api/client'
import { NotImplementedError } from '../../api/errors'
import { useAppDispatch, useAppState } from '../../state/hooks'
import { Button } from '../common/Button'

export function IssueListScreen() {
  const { issues, currentIssueIndex } = useAppState()
  const dispatch = useAppDispatch()

  const issue = issues[currentIssueIndex]
  if (!issue) {
    return (
      <div className="screen issue-list-screen">
        <p>발견된 이슈가 없습니다.</p>
        <Button onClick={() => dispatch({ type: 'NAVIGATE', screen: 'history' })}>다음</Button>
      </div>
    )
  }

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
      <h1>이슈 리뷰</h1>
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
        <dd>{issue.suggestion}</dd>
      </dl>

      <div className="issue-actions">
        <Button variant="primary" onClick={() => void stageDecision('apply')}>
          적용
        </Button>
        <Button variant="secondary" onClick={() => void stageDecision('skip')}>
          스킵
        </Button>
        <Button variant="secondary" onClick={() => dispatch({ type: 'NAVIGATE', screen: 'edit' })}>
          직접 수정
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
          <Button onClick={() => dispatch({ type: 'NAVIGATE', screen: 'history' })}>검토 완료</Button>
        ) : (
          <Button
            variant="secondary"
            onClick={() => dispatch({ type: 'NAVIGATE_ISSUE', direction: 'next' })}
          >
            다음
          </Button>
        )}
      </div>
    </div>
  )
}
