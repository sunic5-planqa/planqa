import { useState } from 'react'
import { api } from '../../api/client'
import { NotImplementedError } from '../../api/errors'
import { useAppDispatch, useAppState } from '../../state/hooks'
import { Button } from '../common/Button'

export function IssueEditScreen() {
  const { issues, currentIssueIndex } = useAppState()
  const dispatch = useAppDispatch()
  const issue = issues[currentIssueIndex]
  const [editedText, setEditedText] = useState(issue?.suggestion ?? '')

  if (!issue) return null

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

  return (
    <div className="screen issue-edit-screen">
      <h1 className="panel-title">AI QA Service</h1>
      <hr className="panel-divider" />
      <h2>직접 수정</h2>
      <p className="hint">원문: {issue.input_text}</p>

      <textarea value={editedText} onChange={(e) => setEditedText(e.target.value)} rows={6} />

      <div className="issue-actions">
        <Button className="btn-bracket" onClick={() => void handleApply()}>
          적용
        </Button>
        <Button variant="secondary" className="btn-bracket" onClick={() => dispatch({ type: 'NAVIGATE', screen: 'issues' })}>
          취소
        </Button>
      </div>
    </div>
  )
}
