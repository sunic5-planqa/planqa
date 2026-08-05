import { useMemo, useState } from 'react'
import { api } from '../../api/client'
import { NotImplementedError } from '../../api/errors'
import { useAppDispatch, useAppState } from '../../state/hooks'
import { validateEdit } from '../../state/editValidation'
import { Button } from '../common/Button'

export function IssueEditScreen() {
  const { issues, currentIssueIndex, issueEdits } = useAppState()
  const dispatch = useAppDispatch()
  const issue = issues[currentIssueIndex]
  const [editedText, setEditedText] = useState(
    () => issueEdits[issue?.id ?? '']?.editedText ?? issue?.suggestion ?? '',
  )
  const [warningAcknowledged, setWarningAcknowledged] = useState(false)

  const validation = useMemo(() => (issue ? validateEdit(issue, editedText) : null), [issue, editedText])
  const hasWarning = validation ? !validation.issueLikelyResolved || !validation.matchesSuggestionClosely : false

  if (!issue) return null

  const handleTextChange = (value: string) => {
    setEditedText(value)
    setWarningAcknowledged(false)
  }

  const handleApply = async () => {
    dispatch({ type: 'STAGE_ISSUE_EDIT', issueId: issue.id, action: 'edit', editedText })
    try {
      await api.updateIssue(issue.id, { action: 'edit', edited_text: editedText })
    } catch (err) {
      if (!(err instanceof NotImplementedError)) {
        dispatch({ type: 'SET_ERROR', error: err instanceof Error ? err.message : String(err) })
      }
    }
    dispatch({ type: 'NAVIGATE', screen: 'issues' })
  }

  const handleApplyClick = () => {
    if (hasWarning && !warningAcknowledged) {
      setWarningAcknowledged(true)
      return
    }
    void handleApply()
  }

  return (
    <div className="screen issue-edit-screen">
      <h1 className="panel-title">AI QA Service</h1>
      <hr className="panel-divider" />
      <h2>직접 수정</h2>
      <p className="hint">원문: {issue.input_text}</p>

      <textarea value={editedText} onChange={(e) => handleTextChange(e.target.value)} rows={6} />

      {validation && !validation.issueLikelyResolved && (
        <p className="notice">원래 문제였던 표현이 아직 남아있어요. 정말 해결됐는지 다시 확인해주세요.</p>
      )}
      {validation && !validation.matchesSuggestionClosely && (
        <p className="notice">AI 제안({issue.suggestion})과 많이 달라요. 의도한 수정이 맞는지 확인해주세요.</p>
      )}
      {hasWarning && warningAcknowledged && <p className="notice">적용을 한 번 더 누르면 경고를 무시하고 저장돼요.</p>}

      <div className="issue-actions">
        <Button className="btn-bracket" onClick={handleApplyClick}>
          적용
        </Button>
        <Button variant="secondary" className="btn-bracket" onClick={() => dispatch({ type: 'NAVIGATE', screen: 'issues' })}>
          취소
        </Button>
      </div>
    </div>
  )
}
