import { useMemo, useState } from 'react'
import { api } from '../../api/client'
import { NotImplementedError } from '../../api/errors'
import type { IssueResponse } from '../../api/types'
import { useAppState } from '../../state/hooks'
import type { IssueEdit } from '../../state/types'
import { Button } from '../common/Button'

// 백엔드 export(GET /documents/{id}/export)가 준비될 때까지, 적용/수정된 이슈를 rawText에
// 문자열 치환으로 반영한 로컬 미리보기. Issue 응답에 오프셋(start/end)이 없어 offset splicing
// 대신 input_text 기반 치환을 쓴다 — 정밀하지 않지만 데모/검토 목적으로는 충분.
function buildWorkingTextPreview(rawText: string, issues: IssueResponse[], issueEdits: Record<string, IssueEdit>) {
  let workingText = rawText
  for (const issue of issues) {
    const edit = issueEdits[issue.id]
    if (!edit || edit.action === 'skip') continue
    const replacement = edit.action === 'edit' ? (edit.editedText ?? issue.input_text) : issue.suggestion
    workingText = workingText.replace(issue.input_text, replacement)
  }
  return workingText
}

export function HistoryExportScreen() {
  const { rawText, issues, issueEdits, documentId } = useAppState()
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'preview'>('idle')

  const workingTextPreview = useMemo(
    () => buildWorkingTextPreview(rawText, issues, issueEdits),
    [rawText, issues, issueEdits],
  )

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
      <h1>QA 검토 히스토리</h1>

      <div className="history-compare">
        <div>
          <h2>원본</h2>
          <pre>{rawText}</pre>
        </div>
        <div>
          <h2>수정본</h2>
          <pre>{workingTextPreview}</pre>
        </div>
      </div>

      <Button onClick={() => void handleExport()}>복사</Button>

      {copyStatus === 'copied' && <p className="notice">클립보드에 복사했습니다.</p>}
      {copyStatus === 'preview' && <p className="notice">export API 준비중 — 로컬 미리보기를 복사했습니다.</p>}
    </div>
  )
}
