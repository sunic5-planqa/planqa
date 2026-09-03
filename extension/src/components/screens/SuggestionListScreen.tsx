import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import { NotImplementedError } from '../../api/errors'
import type { SuggestionEditSavedMessage } from '../../content/messages'
import { useAppDispatch, useAppState } from '../../state/hooks'
import { getRuleSource } from '../../state/ruleSourceDefaults'
import { deriveProgress } from '../../state/suggestionProgress'
import { Button } from '../common/Button'
import { ConfirmDialog } from '../common/ConfirmDialog'
import { SuggestionCard } from '../suggestions/SuggestionCard'
import { SuggestionExpandPanel } from '../suggestions/SuggestionExpandPanel'

// 3 — 수정 방향성 제안을 한 화면에 전부 나열한다(예전의 목록→상세 위저드는 폐기). 각 카드는
// 원래(위치) 순서 그대로 있고, 클릭하면 그 자리에서 펼쳐진다(맨 위로 이동하거나 순서를 바꾸지
// 않는다). 처리(적용/건너뜀)는 카드마다 독립적으로 하고, 하단 "수정완료/다시검사"는 남은 이슈
// 유무와 무관하게 항상 누를 수 있다.
export function SuggestionListScreen() {
  const { issues, issueEdits, activeIssueId, activeLocationIndex } = useAppState()
  const dispatch = useAppDispatch()
  const [confirmingRecheck, setConfirmingRecheck] = useState(false)

  const progress = deriveProgress(issues, issueEdits)
  const teamCount = issues.filter((issue) => getRuleSource(issue) === 'team').length
  const builtinCount = issues.length - teamCount
  const processedCount = progress.done + progress.skipped
  const percent = progress.total === 0 ? 0 : Math.round((processedCount / progress.total) * 100)

  // 왼쪽 문서에서 직접 편집이 저장되면 content script가 SUGGESTION_EDIT_SAVED를 발사한다 —
  // content script는 issueId를 모르므로, 지금 펼쳐져 있는 카드(activeIssueId)와 위치
  // 내비게이터(activeLocationIndex)를 기준으로 여기서 STAGE_ISSUE_EDIT을 처리한다. 위저드와 달리
  // 다음 제안으로 자동 이동하지 않고, 카드도 접지 않는다(펼침·회색 상태 그대로 유지).
  useEffect(() => {
    if (!activeIssueId) return
    const activeIssue = issues.find((issue) => issue.id === activeIssueId)
    if (!activeIssue) return
    const target: 'primary' | 'related' =
      activeLocationIndex === 1 && activeIssue.related_original_text ? 'related' : 'primary'

    const listener = (message: SuggestionEditSavedMessage) => {
      if (message.type !== 'SUGGESTION_EDIT_SAVED') return
      dispatch({ type: 'STAGE_ISSUE_EDIT', issueId: activeIssue.id, action: 'edit', target, editedText: message.newText })
      void api.updateIssue(activeIssue.id, { action: 'edit', edited_text: message.newText }).catch((err) => {
        if (!(err instanceof NotImplementedError)) {
          dispatch({ type: 'SET_ERROR', error: err instanceof Error ? err.message : String(err) })
        }
      })
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [issues, activeIssueId, activeLocationIndex, dispatch])

  const toggleCard = (issueId: string) => {
    if (activeIssueId === issueId) dispatch({ type: 'CLEAR_ACTIVE_ISSUE' })
    else dispatch({ type: 'SELECT_ISSUE_BY_ID', issueId })
  }

  const markDone = () => {
    dispatch({ type: 'FINALIZE_UNRESOLVED_AS_SKIPPED' })
    for (const issue of issues) {
      if (issueEdits[issue.id] === undefined) {
        void api.updateIssue(issue.id, { action: 'skip' }).catch((err) => {
          if (!(err instanceof NotImplementedError)) {
            dispatch({ type: 'SET_ERROR', error: err instanceof Error ? err.message : String(err) })
          }
        })
      }
    }
    dispatch({ type: 'NAVIGATE', screen: 'suggestion-summary' })
  }

  const confirmRecheck = () => {
    setConfirmingRecheck(false)
    dispatch({ type: 'RESET_QA_SESSION' })
    dispatch({ type: 'NAVIGATE', screen: 'main' })
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
              <div key={issue.id} className="suggestion-card-slot">
                <SuggestionCard
                  issue={issue}
                  status={issueEdits[issue.id]?.action}
                  expanded={activeIssueId === issue.id}
                  onClick={() => toggleCard(issue.id)}
                />
                {activeIssueId === issue.id && <SuggestionExpandPanel issue={issue} />}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="screen-footer suggestion-list-footer">
        <Button variant="outline-pill" onClick={() => setConfirmingRecheck(true)}>
          다시검사
        </Button>
        <Button className="btn-cta" onClick={markDone}>
          수정완료
        </Button>
      </div>

      {confirmingRecheck && (
        <ConfirmDialog
          message="지금까지 처리한 수정 내용을 초기화하고 QA를 다시 실행합니다."
          confirmLabel="다시검사"
          onConfirm={confirmRecheck}
          onCancel={() => setConfirmingRecheck(false)}
        />
      )}
    </div>
  )
}
