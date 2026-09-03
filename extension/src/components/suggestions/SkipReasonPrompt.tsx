import { useState } from 'react'

// 건너뛰기 사유는 선택사항이다 — 빈 사유로도 바로 건너뛸 수 있어야 하고(사용자에게 모든 오류를
// 하나씩 해명하도록 강제하지 않는다), 사유를 적었으면 그 값은 기존대로 저장된다.
export function SkipReasonPrompt({
  onConfirm,
  onCancel,
}: {
  onConfirm: (reason?: string) => void
  onCancel: () => void
}) {
  const [reason, setReason] = useState('')

  return (
    <div className="skip-reason-prompt">
      <span className="issue-detail-label">건너뛰는 이유 (선택)</span>
      <textarea
        className="issue-edit-textarea"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        placeholder="남기고 싶으면 짧게 적어주세요 — 비워둬도 건너뛸 수 있어요"
        autoFocus
      />
      <div className="issue-edit-actions-row">
        <button type="button" className="issue-edit-cancel" onClick={onCancel}>
          취소
        </button>
        <button type="button" className="issue-edit-save" onClick={() => onConfirm(reason.trim() || undefined)}>
          건너뛰기 확정
        </button>
      </div>
    </div>
  )
}
