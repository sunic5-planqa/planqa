import { useState } from 'react'
import { api } from '../../api/client'
import { NotImplementedError } from '../../api/errors'
import type { ApplyIssueEditRequest, ApplyIssueEditResponse } from '../../content/messages'
import { OverviewPanel } from '../issues/OverviewPanel'
import { isIssueLikelyResolved } from '../../state/editValidation'
import { useAppDispatch, useAppState } from '../../state/hooks'
import { Button } from '../common/Button'

const RESOLVED_ACTIONS = new Set(['apply', 'edit'])

export function IssueListScreen() {
  const { issues, currentIssueIndex, issueEdits, editingIssueId } = useAppState()
  const dispatch = useAppDispatch()

  const resolvedCount = issues.filter((i) => RESOLVED_ACTIONS.has(issueEdits[i.id]?.action ?? '')).length
  const remainingCount = issues.length - resolvedCount

  const issue = issues[currentIssueIndex]
  // insert_range(MI=정보 누락)는 "원문을 AI 제안으로 교체"할 대상 자체가 없다 — input_text가
  // 비어있거나(원래 없어야 할 텍스트라서), 문서 쪽 하이라이트는 최후 수단으로 섹션 제목을 감싸고
  // 있을 뿐이다(issueOverlay.ts의 wrapIssueByLocationHeading). 여길 그대로 "수정 저장" 가능하게
  // 두면 섹션 제목이 "이 정보를 추가하세요" 같은 제안 문구로 통째로 덮어써지는 사고가 난다.
  const isInsertRangeIssue = issue?.frame_type === 'insert_range'
  const isEditing = !isInsertRangeIssue && issue !== undefined && editingIssueId === issue.id

  // 렌더 중에 파생시키는 초안 — draft.issueId가 지금 보고 있는 이슈와 다르면(편집을 처음 시작했거나
  // "수정 복구"로 초기화한 경우) AI 제안으로 폴백한다. useEffect로 props→state를 동기화하지 않아도 돼서
  // 더 단순하고, 렌더 중 setState를 유발하지 않는다.
  const [draft, setDraft] = useState<{ issueId: string; text: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [warningAcknowledged, setWarningAcknowledged] = useState(false)
  const [similarityWarning, setSimilarityWarning] = useState<string | null>(null)
  const [checkingSimilarity, setCheckingSimilarity] = useState(false)

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
  const issueLikelyResolved = isEditing ? isIssueLikelyResolved(issue.input_text, draftText) : true

  const startEdit = () => {
    setSaveError(null)
    setWarningAcknowledged(false)
    setSimilarityWarning(null)
    dispatch({ type: 'START_EDIT_ISSUE', issueId: issue.id })
  }

  const cancelEdit = () => {
    setDraft(null)
    setSaveError(null)
    setSimilarityWarning(null)
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

  // 처음 누르면: (1) 원래 문제 문구가 아직 남아있는지(로컬, 즉시) → (2) AI 제안과 비슷한지(백엔드
  // 유사도 검사, /issues/similarity-check) 순서로 확인한다. 둘 중 하나라도 걸리면 저장하지 않고
  // 경고만 띄운 채 리턴 — 사용자가 "수정 저장"을 한 번 더 눌러야(warningAcknowledged) 그대로 반영된다.
  // 백엔드 호출이 실패해도(네트워크 문제 등) 저장 자체를 막지는 않는다 — 유사도 검사는 안전장치일 뿐
  // 필수 게이트가 아니기 때문.
  const handleSaveClick = async () => {
    if (warningAcknowledged) {
      void saveEdit()
      return
    }

    if (!issueLikelyResolved) {
      setSimilarityWarning(null)
      setWarningAcknowledged(true)
      return
    }

    setCheckingSimilarity(true)
    try {
      const result = await api.checkEditSimilarity(issue.suggestion, draftText)
      if (!result.matches_closely) {
        setSimilarityWarning(`AI 제안 "${issue.suggestion}"과 다소 달라요 (유사도 ${Math.round(result.similarity * 100)}%).`)
        setWarningAcknowledged(true)
        return
      }
    } catch {
      // 유사도 검사 실패는 무시하고 저장은 계속 진행한다.
    } finally {
      setCheckingSimilarity(false)
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
                !isInsertRangeIssue &&
                (isResolved ? (
                  <span className="resolved-badge">✓ 수정완료</span>
                ) : (
                  <button type="button" className="issue-fix-link" onClick={startEdit}>
                    <span className="issue-fix-link-text">오류 수정하기</span>
                    <svg className="issue-fix-link-icon" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                      <circle cx="6" cy="6" r="5.25" stroke="currentColor" strokeWidth="1" />
                      <path
                        d="M4.4 7.6 7.3 4.7a.5.5 0 0 1 .7 0l.3.3a.5.5 0 0 1 0 .7L5.4 8.6l-1.2.3.2-1.3Z"
                        fill="currentColor"
                      />
                    </svg>
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
                  setSimilarityWarning(null)
                }}
                rows={4}
                autoFocus
              />
            ) : (
              <p className="issue-suggestion-text">{suggestion}</p>
            )}
            {isInsertRangeIssue && (
              <p className="issue-suggestion-hint">
                문서에 없는 내용을 추가하라는 안내라, 자동으로 반영할 수 없어요. 문서에서 표시된
                위치를 직접 확인하고 반영해주세요.
              </p>
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
            <button
              type="button"
              className="issue-edit-save"
              onClick={() => void handleSaveClick()}
              disabled={saving || checkingSimilarity}
            >
              {saving ? '저장 중...' : checkingSimilarity ? '확인 중...' : '수정 저장 ✓'}
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

        {isEditing && warningAcknowledged && !issueLikelyResolved && (
          <p className="issue-edit-notice">
            원래 문제였던 표현이 아직 남아있어요. 정말 해결됐으면 "수정 저장"을 한 번 더 눌러주세요.
          </p>
        )}
        {isEditing && similarityWarning && (
          <p className="issue-edit-notice">{similarityWarning} 의도한 수정이 맞으면 "수정 저장"을 한 번 더 눌러주세요.</p>
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
