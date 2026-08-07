import { useState } from 'react'
import { api } from '../../api/client'
import { NotImplementedError } from '../../api/errors'
import type { ApplyIssueEditRequest, ApplyIssueEditResponse } from '../../content/messages'
import { OverviewPanel } from '../issues/OverviewPanel'
import { validateEdit } from '../../state/editValidation'
import { useAppDispatch, useAppState } from '../../state/hooks'
import { Button } from '../common/Button'

const RESOLVED_ACTIONS = new Set(['apply', 'edit'])

export function IssueListScreen() {
  const { issues, currentIssueIndex, issueEdits, editingIssueId } = useAppState()
  const dispatch = useAppDispatch()

  const resolvedCount = issues.filter((i) => RESOLVED_ACTIONS.has(issueEdits[i.id]?.action ?? '')).length
  const remainingCount = issues.length - resolvedCount

  const issue = issues[currentIssueIndex]
  const isEditing = issue !== undefined && editingIssueId === issue.id

  // 렌더 중에 파생시키는 초안 — draft.issueId가 지금 보고 있는 이슈와 다르면(편집을 처음 시작했거나
  // "수정 복구"로 초기화한 경우) AI 제안으로 폴백한다. useEffect로 props→state를 동기화하지 않아도 돼서
  // 더 단순하고, 렌더 중 setState를 유발하지 않는다.
  const [draft, setDraft] = useState<{ issueId: string; text: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [warningAcknowledged, setWarningAcknowledged] = useState(false)

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
  const draftText = draft?.issueId === issue.id ? draft.text : suggestion
  const validation = isEditing ? validateEdit(issue, draftText) : null
  const hasWarning = validation ? !validation.issueLikelyResolved || !validation.matchesSuggestionClosely : false

  const startEdit = () => {
    setSaveError(null)
    setWarningAcknowledged(false)
    dispatch({ type: 'START_EDIT_ISSUE', issueId: issue.id })
  }

  const cancelEdit = () => {
    setDraft(null)
    setSaveError(null)
    dispatch({ type: 'STOP_EDIT_ISSUE' })
  }

  const saveEdit = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab.id) {
        setSaveError('컨플루언스 탭을 찾을 수 없습니다.')
        return
      }

      const response = await chrome.tabs.sendMessage<ApplyIssueEditRequest, ApplyIssueEditResponse>(tab.id, {
        type: 'APPLY_ISSUE_EDIT',
        issueId: issue.id,
        oldText: issue.input_text,
        newText: draftText,
      })

      if (!response.ok) {
        setSaveError(response.error)
        return
      }

      dispatch({ type: 'STAGE_ISSUE_EDIT', issueId: issue.id, action: 'edit', editedText: draftText })
      dispatch({ type: 'STOP_EDIT_ISSUE' })
      setDraft(null)

      try {
        await api.updateIssue(issue.id, { action: 'edit', edited_text: draftText })
      } catch (err) {
        if (!(err instanceof NotImplementedError)) {
          dispatch({ type: 'SET_ERROR', error: err instanceof Error ? err.message : String(err) })
        }
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const handleSaveClick = () => {
    if (hasWarning && !warningAcknowledged) {
      setWarningAcknowledged(true)
      return
    }
    void saveEdit()
  }

  return (
    <div className="screen issue-list-screen">
      <div className="screen-scroll">
        <h1 className="panel-title">AI QA Service</h1>
        <hr className="panel-divider" />

        <OverviewPanel issues={issues} currentIssueId={issue.id} />

        {isEditing ? (
          <p className="issue-editing-status">
            <span className="issue-editing-dot">•</span> 수정 진행 중...
          </p>
        ) : (
          <p className="issue-error-count">
            문서 오류 <strong>{remainingCount}</strong>개
          </p>
        )}

        <div className="issue-detail-card">
          <div className="issue-detail-block">
            <span className="issue-detail-label">입력내용</span>
            <p className="issue-detail-value">{issue.input_text}</p>
          </div>

          <div className={`issue-suggestion-box ${isEditing ? 'issue-suggestion-box-editing' : ''}`.trim()}>
            <div className="issue-suggestion-row">
              <span className="issue-detail-label">수정제안</span>
              {!isEditing &&
                (isResolved ? (
                  <span className="resolved-badge">✓ 수정완료</span>
                ) : (
                  <button type="button" className="issue-fix-link" onClick={startEdit}>
                    오류 수정하기 ✏️
                  </button>
                ))}
            </div>
            {isEditing ? (
              <textarea
                className="issue-edit-textarea"
                value={draftText}
                onChange={(e) => {
                  setDraft({ issueId: issue.id, text: e.target.value })
                  setWarningAcknowledged(false)
                }}
                rows={4}
                autoFocus
              />
            ) : (
              <p className="issue-suggestion-text">{suggestion}</p>
            )}
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

        {isEditing ? (
          <div className="issue-edit-actions-row">
            <button type="button" className="issue-edit-cancel" onClick={cancelEdit} disabled={saving}>
              수정 복구 ✕
            </button>
            <button type="button" className="issue-edit-save" onClick={handleSaveClick} disabled={saving}>
              {saving ? '저장 중...' : '수정 저장 ✓'}
            </button>
          </div>
        ) : (
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
        )}

        {isEditing && validation && !validation.issueLikelyResolved && (
          <p className="issue-edit-notice">원래 문제였던 표현이 아직 남아있어요. 정말 해결됐는지 다시 확인해주세요.</p>
        )}
        {isEditing && validation && !validation.matchesSuggestionClosely && (
          <p className="issue-edit-notice">AI 제안({issue.suggestion})과 많이 달라요. 의도한 수정이 맞는지 확인해주세요.</p>
        )}
        {isEditing && saveError && <p className="issue-edit-notice issue-edit-notice-error">{saveError}</p>}
      </div>

      <div className="screen-footer">
        <Button className="btn-cta" onClick={() => dispatch({ type: 'NAVIGATE', screen: 'history' })}>
          QA 완료
        </Button>
      </div>
    </div>
  )
}
