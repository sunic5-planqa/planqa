import { useMemo, useState } from 'react'
import { api } from '../../api/client'
import { NotImplementedError } from '../../api/errors'
import type { IssueResponse } from '../../api/types'
import { useAppDispatch, useAppState } from '../../state/hooks'
import type { IssueEdit } from '../../state/types'
import { Button } from '../common/Button'

function resolveReplacement(issue: IssueResponse, edit: IssueEdit | undefined): string | null {
  if (!edit || edit.action === 'skip') return null
  return edit.action === 'edit' ? (edit.editedText ?? issue.input_text) : issue.suggestion
}

// 백엔드 export(GET /documents/{id}/export)가 준비될 때까지, 적용/수정된 이슈를 원본 텍스트에
// 문자열 치환으로 반영한 로컬 미리보기. Issue 응답에 오프셋(start/end)이 없어 offset splicing
// 대신 input_text 기반 치환을 쓴다 — 정밀하지 않지만 데모/검토 목적으로는 충분.
function buildWorkingTextPreview(sourceText: string, issues: IssueResponse[], issueEdits: Record<string, IssueEdit>) {
  let workingText = sourceText
  for (const issue of issues) {
    const replacement = resolveReplacement(issue, issueEdits[issue.id])
    if (replacement === null) continue
    workingText = workingText.replace(issue.input_text, replacement)
  }
  return workingText
}

export function HistoryExportScreen() {
  const { confluenceMarkdown, issues, issueEdits, documentId } = useAppState()
  const dispatch = useAppDispatch()
  const sourceText = confluenceMarkdown ?? ''
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'preview'>('idle')
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null)

  const workingTextPreview = useMemo(
    () => buildWorkingTextPreview(sourceText, issues, issueEdits),
    [sourceText, issues, issueEdits],
  )

  const resolvedIssues = issues
    .map((issue) => ({ issue, replacement: resolveReplacement(issue, issueEdits[issue.id]) }))
    .filter((entry): entry is { issue: IssueResponse; replacement: string } => entry.replacement !== null)

  const handleExport = async () => {
    let exportText = workingTextPreview
    let usedFallback = true

    if (documentId) {
      try {
        const result = await api.exportDocument(documentId)
        exportText = result.export_text
        usedFallback = false
      } catch (err) {
        if (!(err instanceof NotImplementedError)) throw err
      }
    }

    await navigator.clipboard.writeText(exportText)
    setCopyStatus(usedFallback ? 'preview' : 'copied')
  }

  return (
    <div className="screen history-export-screen">
      <h1 className="panel-title">AI QA Service</h1>
      <hr className="panel-divider" />
      <h2>QA 검토</h2>

      {resolvedIssues.length === 0 ? (
        <p className="hint">적용되거나 수정된 항목이 없습니다.</p>
      ) : (
        <div className="diff-list">
          {resolvedIssues.map(({ issue, replacement }) => (
            <button
              key={issue.id}
              type="button"
              className={`diff-item ${selectedIssueId === issue.id ? 'selected' : ''}`}
              onClick={() => setSelectedIssueId(issue.id)}
            >
              <span className="diff-original">{issue.input_text}</span>
              <span className="diff-revised">{replacement}</span>
            </button>
          ))}
        </div>
      )}

      <div className="qa-start-row">
        <Button className="btn-bracket" onClick={() => void handleExport()}>
          문서 복사
        </Button>
      </div>

      <div className="issue-actions">
        <Button variant="secondary" className="btn-link" onClick={() => dispatch({ type: 'NAVIGATE', screen: 'main' })}>
          종료
        </Button>
      </div>

      {copyStatus === 'copied' && <p className="notice">클립보드에 복사했습니다.</p>}
      {copyStatus === 'preview' && <p className="notice">export API 준비중 — 로컬 미리보기를 복사했습니다.</p>}
    </div>
  )
}
