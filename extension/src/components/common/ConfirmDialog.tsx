import { Button } from './Button'

interface ConfirmDialogProps {
  message: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ message, confirmLabel = '삭제', onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div className="confirm-dialog-overlay">
      <div className="confirm-dialog-card">
        <p className="confirm-dialog-message">{message}</p>
        <div className="confirm-dialog-actions">
          <Button variant="secondary" onClick={onCancel}>
            취소
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
