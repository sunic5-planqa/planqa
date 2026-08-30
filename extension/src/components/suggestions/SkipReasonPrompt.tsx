import { useState } from 'react'

// 건너뛰기엔 사유 입력이 필요하다는 디자인 요구사항 — 이 레포엔 모달 인프라가 없어서 카드 안에
// 펼쳐지는 인라인 블록으로 구현한다("기존 건너뛰기 사유 시트"는 이 레포에 실제로 존재하지 않음,
// 확인 완료 — 그래서 최소 형태로 새로 만든 것).
export function SkipReasonPrompt({ onConfirm, onCancel }: { onConfirm: (reason: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState('')

  return (
    <div className="skip-reason-prompt">
      <span className="issue-detail-label">건너뛰는 이유</span>
      <textarea
        className="issue-edit-textarea"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        placeholder="왜 건너뛰는지 짧게 남겨주세요"
        autoFocus
      />
      <div className="issue-edit-actions-row">
        <button type="button" className="issue-edit-cancel" onClick={onCancel}>
          취소
        </button>
        <button
          type="button"
          className="issue-edit-save"
          disabled={!reason.trim()}
          onClick={() => onConfirm(reason.trim())}
        >
          건너뛰기 확정
        </button>
      </div>
    </div>
  )
}
