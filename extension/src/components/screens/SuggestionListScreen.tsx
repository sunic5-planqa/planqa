import { useAppDispatch, useAppState } from '../../state/hooks'
import { getRuleSource } from '../../state/ruleSourceDefaults'
import { deriveProgress, getOpenIssues } from '../../state/suggestionProgress'
import { Button } from '../common/Button'
import { SuggestionCard } from '../suggestions/SuggestionCard'

// 3a — QA 시작 직후 검출된 제안을 한눈에 보고 처리 순서를 잡는 목록 화면. 카드는 팀/기본 규칙으로
// 묶지 않고 원래(위치) 순서 그대로 나열한다 — 실제 .dc.html 레퍼런스도 README의 "그룹핑" 설명과
// 달리 뒤섞인 순서로 카드를 보여준다(판단 지점 #7). 심각도(High/Medium/Low) 개념은 쓰지 않는다.
export function SuggestionListScreen() {
  const { issues, issueEdits } = useAppState()
  const dispatch = useAppDispatch()

  const progress = deriveProgress(issues, issueEdits)
  const teamCount = issues.filter((issue) => getRuleSource(issue) === 'team').length
  const builtinCount = issues.length - teamCount
  const processedCount = progress.done + progress.skipped
  const percent = progress.total === 0 ? 0 : Math.round((processedCount / progress.total) * 100)

  const startFirstOpen = () => {
    const open = getOpenIssues(issues, issueEdits)
    if (open.length > 0) dispatch({ type: 'SELECT_ISSUE_BY_ID', issueId: open[0].id })
    else dispatch({ type: 'NAVIGATE', screen: 'suggestion-summary' })
  }

  return (
    <div className="screen suggestion-list-screen">
      <div className="screen-scroll">
        <h1 className="panel-title">AI QA Service</h1>
        <hr className="panel-divider" />

        <div className="suggestion-list-heading-row">
          <h2 className="suggestion-list-heading">수정 방향성 제안</h2>
          <span className="suggestion-list-count">(검토 완료 · {issues.length}건)</span>
        </div>

        <div className="suggestion-list-chips">
          <span className="suggestion-chip suggestion-chip-team">팀 규칙 {teamCount}</span>
          <span className="suggestion-chip suggestion-chip-builtin">기본 규칙 {builtinCount}</span>
        </div>

        <div className="progress-bar">
          <div className="progress-bar-track">
            <div className="progress-bar-fill" style={{ width: `${percent}%` }} />
          </div>
        </div>
        <p className="suggestion-list-progress-label">
          {processedCount} / {progress.total} 처리
        </p>

        {issues.length === 0 ? (
          <p className="hint">발견된 이슈가 없습니다.</p>
        ) : (
          <div className="suggestion-card-list">
            {issues.map((issue) => (
              <SuggestionCard
                key={issue.id}
                issue={issue}
                status={issueEdits[issue.id]?.action}
                onClick={() => dispatch({ type: 'SELECT_ISSUE_BY_ID', issueId: issue.id })}
              />
            ))}
          </div>
        )}
      </div>

      <div className="screen-footer">
        <Button className="btn-cta" onClick={startFirstOpen}>
          첫 제안부터 보기
        </Button>
      </div>
    </div>
  )
}
