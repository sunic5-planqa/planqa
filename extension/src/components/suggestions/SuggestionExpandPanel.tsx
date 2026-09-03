import { useState } from 'react'
import type { IssueResponse } from '../../api/types'
import { useIssueResolution } from '../../hooks/useIssueResolution'
import { useAppState } from '../../state/hooks'
import { Button } from '../common/Button'
import { LocationNavigator } from './LocationNavigator'
import { RuleEvidenceCard } from './RuleEvidenceCard'
import { SkipReasonPrompt } from './SkipReasonPrompt'
import { SuggestionDirectionCard } from './SuggestionDirectionCard'

// 통합 화면에서 카드를 펼쳤을 때 그 아래 나오는 내용 — 예전 SuggestionDetailScreen의
// "현재 작업 중 카드"를 그대로 옮겨왔다. 편집(수정)은 왼쪽 문서에서, 처리(적용/건너뜀)는 여기
// 버튼으로. 이미 처리된 이슈는 버튼 대신 상태 + 되돌리기를 보여준다.
export function SuggestionExpandPanel({ issue }: { issue: IssueResponse }) {
  const { issueEdits } = useAppState()
  const { applyFix, skip, unstage } = useIssueResolution(issue.id)
  const [skipping, setSkipping] = useState(false)

  const edit = issueEdits[issue.id]
  const resolved = edit !== undefined

  return (
    <div className="suggestion-expand-panel">
      <div className="suggestion-detail-current-card">
        <RuleEvidenceCard issue={issue} />
        <SuggestionDirectionCard issue={issue} />
        <LocationNavigator issue={issue} />
      </div>

      {resolved ? (
        <div className="suggestion-expand-resolved-row">
          <span className="suggestion-expand-resolved-label">
            {edit.action === 'skip' ? '건너뜀' : '수정 완료'}
            {edit.action === 'skip' && edit.skipReason ? ` · ${edit.skipReason}` : ''}
          </span>
          <button type="button" className="suggestion-detail-undo-link" onClick={unstage}>
            되돌리기
          </button>
        </div>
      ) : skipping ? (
        <SkipReasonPrompt
          onConfirm={(reason) => {
            setSkipping(false)
            skip(reason)
          }}
          onCancel={() => setSkipping(false)}
        />
      ) : (
        <div className="suggestion-expand-actions-row">
          <Button variant="outline-pill" onClick={() => setSkipping(true)}>
            건너뛰기
          </Button>
          <Button className="btn-cta" onClick={applyFix}>
            수정 적용
          </Button>
        </div>
      )}
    </div>
  )
}
