import type { IssueAction, IssueResponse } from '../../api/types'
import { getRuleName, getRuleSource } from '../../state/ruleSourceDefaults'
import { formatLocationLabel } from '../../utils/locationLabel'
import { SourceBadge } from './SourceBadge'

// 디자인 레퍼런스의 카드는 배지 + 규칙명(작게) + 제목(굵게, 구체적 문제 한 줄) + 보조 설명(위치)
// 4단 구조인데, 실제 IssueResponse엔 "제목"에 해당하는 별도 필드가 없다 — reason(검증이유)이
// 이미 "무엇이 문제인지"를 한 줄로 설명하는 텍스트라 그걸 제목 자리에 쓰고, location을 보조 설명
// 자리에 쓴다(criteria는 그대로 규칙명 자리).
export function SuggestionCard({
  issue,
  status,
  onClick,
}: {
  issue: IssueResponse
  status: IssueAction | undefined
  onClick: () => void
}) {
  return (
    <button type="button" className="suggestion-card" onClick={onClick}>
      <div className="suggestion-card-header">
        <SourceBadge source={getRuleSource(issue)} />
        <span className="suggestion-card-rule-name">{getRuleName(issue)}</span>
        {(status === 'apply' || status === 'edit') && <span className="resolved-badge">✓ 수정완료</span>}
        {status === 'skip' && <span className="suggestion-card-skipped">건너뜀</span>}
      </div>
      <p className="suggestion-card-title">{issue.reason}</p>
      <p className="suggestion-card-desc">
        {formatLocationLabel(issue.location, issue.location_number)}
        {issue.related_location && <> ↔ {issue.related_location}</>}
      </p>
    </button>
  )
}
