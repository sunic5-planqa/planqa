import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import { NotImplementedError } from '../../api/errors'
import type { SuggestionEditSavedMessage } from '../../content/messages'
import { useAppDispatch, useAppState } from '../../state/hooks'
import { getNextOpenIssueId } from '../../state/suggestionProgress'
import type { IssueEdit } from '../../state/types'
import { Button } from '../common/Button'
import { LocationNavigator } from '../suggestions/LocationNavigator'
import { RuleEvidenceCard } from '../suggestions/RuleEvidenceCard'
import { SkipReasonPrompt } from '../suggestions/SkipReasonPrompt'
import { SuggestionDirectionCard } from '../suggestions/SuggestionDirectionCard'

// 3b(첫 제안, 완료 스택이 비어있음)와 3c(진행 중, 완료 스택+남은 목록이 채워짐)를 화면 하나로
// 합쳤다 — 실제로는 같은 "지금 이 제안 작업 중" 화면이 진행 상황에 따라 다르게 보일 뿐이고,
// README의 3b 예시조차 이미 "2/6"이라 완전히 빈 상태의 "깨끗한 3b"가 따로 있지 않다.
export function SuggestionDetailScreen() {
  const { issues, activeIssueId, activeLocationIndex, issueEdits } = useAppState()
  const dispatch = useAppDispatch()
  const [skipping, setSkipping] = useState(false)

  const activeIssue = issues.find((issue) => issue.id === activeIssueId)

  // 방금 이 이슈를 해결/건너뛴 결과(entry)를 반영한 issueEdits를 직접 만들어 다음 미해결 이슈를
  // 계산한다 — dispatch 직후엔 리듀서가 아직 반영 전이라 state.issueEdits를 그대로 읽으면 이
  // 이슈가 여전히 "미해결"로 잡혀 다음 이슈 계산이 틀어진다.
  const advanceAfterResolving = (issueId: string, entry: IssueEdit) => {
    const updatedEdits = { ...issueEdits, [issueId]: entry }
    const nextId = getNextOpenIssueId(issues, updatedEdits, issueId)
    if (nextId) dispatch({ type: 'SELECT_ISSUE_BY_ID', issueId: nextId })
    else dispatch({ type: 'NAVIGATE', screen: 'suggestion-summary' })
  }

  // activeIssueId가 issues 배열에 없는 이슈를 가리키는 경우(있을 수 없지만 방어적으로) 목록으로
  // 되돌린다 — 렌더 중에 바로 dispatch하면 안 되므로 effect에서 처리한다.
  useEffect(() => {
    if (!activeIssue) dispatch({ type: 'CLEAR_ACTIVE_ISSUE' })
  }, [activeIssue, dispatch])

  // 문서에서 직접 편집(issueOverlay.ts의 저장/취소 플로팅 박스)이 저장되면 content script가
  // SUGGESTION_EDIT_SAVED를 발사한다 — content script는 issueId를 모르므로, 지금 패널이 보고
  // 있는 activeIssue/activeLocationIndex를 기준으로 여기서 STAGE_ISSUE_EDIT + 다음 제안 이동을
  // 처리한다. 편집은 이제 이 경로가 유일하다(패널 쪽 텍스트 영역 폴백은 제거됨, 2026-08-30).
  useEffect(() => {
    if (!activeIssue) return
    const target: 'primary' | 'related' = activeLocationIndex === 1 && activeIssue.related_original_text ? 'related' : 'primary'

    const listener = (message: SuggestionEditSavedMessage) => {
      if (message.type !== 'SUGGESTION_EDIT_SAVED') return
      dispatch({ type: 'STAGE_ISSUE_EDIT', issueId: activeIssue.id, action: 'edit', target, editedText: message.newText })
      void api.updateIssue(activeIssue.id, { action: 'edit', edited_text: message.newText }).catch((err) => {
        if (!(err instanceof NotImplementedError)) {
          dispatch({ type: 'SET_ERROR', error: err instanceof Error ? err.message : String(err) })
        }
      })
      advanceAfterResolving(activeIssue.id, { action: 'edit', editedText: message.newText })
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
    // advanceAfterResolving은 매 렌더 새로 만들어지는 클로저라 의존성에 넣으면 리스너가 매번
    // 재등록된다 — issues/issueEdits가 이미 의존성에 있어 그 함수가 실제로 참조하는 최신 값은
    // 항상 반영되므로 안전하다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIssue, activeLocationIndex, issues, issueEdits, dispatch])

  if (!activeIssue) return null

  const activeIndex = issues.findIndex((issue) => issue.id === activeIssue.id)
  const doneIssues = issues.filter(
    (issue) => issue.id !== activeIssue.id && (issueEdits[issue.id]?.action === 'apply' || issueEdits[issue.id]?.action === 'edit'),
  )
  const remainingIssues = issues.filter((issue) => issue.id !== activeIssue.id && issueEdits[issue.id] === undefined)

  const handleMarkDone = async () => {
    if (!issueEdits[activeIssue.id]) {
      dispatch({ type: 'STAGE_ISSUE_EDIT', issueId: activeIssue.id, action: 'apply' })
      try {
        await api.updateIssue(activeIssue.id, { action: 'apply' })
      } catch (err) {
        if (!(err instanceof NotImplementedError)) {
          dispatch({ type: 'SET_ERROR', error: err instanceof Error ? err.message : String(err) })
        }
      }
    }
    advanceAfterResolving(activeIssue.id, { action: 'apply' })
  }

  const handleSkipConfirm = async (reason: string) => {
    setSkipping(false)
    dispatch({ type: 'STAGE_ISSUE_EDIT', issueId: activeIssue.id, action: 'skip', skipReason: reason })
    try {
      await api.updateIssue(activeIssue.id, { action: 'skip' })
    } catch (err) {
      if (!(err instanceof NotImplementedError)) {
        dispatch({ type: 'SET_ERROR', error: err instanceof Error ? err.message : String(err) })
      }
    }
    advanceAfterResolving(activeIssue.id, { action: 'skip', skipReason: reason })
  }

  return (
    <div className="screen suggestion-detail-screen">
      <div className="screen-scroll">
        <h1 className="panel-title">AI QA Service</h1>
        <hr className="panel-divider" />

        <div className="suggestion-detail-header-row">
          <button type="button" className="suggestion-detail-back-link" onClick={() => dispatch({ type: 'CLEAR_ACTIVE_ISSUE' })}>
            ‹ 목록으로
          </button>
          <span className="suggestion-detail-counter">
            {activeIndex + 1} / {issues.length}
          </span>
        </div>

        {doneIssues.length > 0 && (
          <div className="suggestion-detail-completed-stack">
            {doneIssues.map((issue) => (
              <div key={issue.id} className="suggestion-detail-completed-card">
                <span className="suggestion-detail-completed-check">✓</span>
                <span className="suggestion-detail-completed-title">{issue.reason}</span>
                <button
                  type="button"
                  className="suggestion-detail-undo-link"
                  onClick={() => dispatch({ type: 'UNSTAGE_ISSUE_EDIT', issueId: issue.id })}
                >
                  되돌리기
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="suggestion-detail-current-card">
          <RuleEvidenceCard issue={activeIssue} />
          <SuggestionDirectionCard issue={activeIssue} />
          <LocationNavigator issue={activeIssue} />
        </div>

        {remainingIssues.length > 0 && (
          <div className="suggestion-detail-remaining-list">
            {remainingIssues.map((issue) => (
              <button
                key={issue.id}
                type="button"
                className="suggestion-detail-remaining-card"
                onClick={() => dispatch({ type: 'SELECT_ISSUE_BY_ID', issueId: issue.id })}
              >
                {issue.reason}
              </button>
            ))}
          </div>
        )}

        {skipping && <SkipReasonPrompt onConfirm={(reason) => void handleSkipConfirm(reason)} onCancel={() => setSkipping(false)} />}
      </div>

      {!skipping && (
        <div className="screen-footer suggestion-detail-footer">
          <Button variant="outline-pill" onClick={() => setSkipping(true)}>
            건너뛰기
          </Button>
          <Button className="btn-cta" onClick={() => void handleMarkDone()}>
            수정 완료로 표시
          </Button>
        </div>
      )}
    </div>
  )
}
