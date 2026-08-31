import type { IssueResponse } from '../../api/types'
import { getRuleDescription, getRuleException, getRuleName, getRuleSource } from '../../state/ruleSourceDefaults'
import { SourceBadge } from './SourceBadge'

// 팀 규칙일 때 표시할 팀 이름 — 실제로는 팀 규칙 출처 자체가 아직 없어서(getRuleSource는 항상
// 'builtin') 지금은 렌더링될 일이 없다. 백엔드가 팀 규칙 데이터를 내려주기 시작하면 이 자리에
// 실제 팀 이름 필드를 연결해야 한다.
const TEAM_LABEL_PLACEHOLDER = '서비스기획 2팀'

export function RuleEvidenceCard({ issue }: { issue: IssueResponse }) {
  const source = getRuleSource(issue)
  const exception = getRuleException(issue)

  return (
    <div className="rule-evidence-card">
      <div className="rule-evidence-header">
        <SourceBadge source={source} />
        <span className="rule-evidence-rule-name">{getRuleName(issue)}</span>
        {source === 'team' && <span className="rule-evidence-team-badge">{TEAM_LABEL_PLACEHOLDER}</span>}
      </div>
      <div className="rule-evidence-block">
        <span className="rule-evidence-label">규칙 설명</span>
        <p className="rule-evidence-text">{getRuleDescription(issue)}</p>
      </div>
      {/* 예외 상황 데이터가 없으면(지금은 항상 없음) 행 자체를 그리지 않는다 — 빈 텍스트로 채우지 않는다. */}
      {exception && (
        <div className="rule-evidence-block">
          <span className="rule-evidence-label">예외 상황</span>
          <p className="rule-evidence-text">{exception}</p>
        </div>
      )}
    </div>
  )
}
