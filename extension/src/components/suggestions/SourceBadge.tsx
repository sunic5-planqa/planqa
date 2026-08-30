import type { RuleSource } from '../../state/ruleSourceDefaults'

// 오늘은 getRuleSource()가 항상 'builtin'을 돌려주므로 'team' 배지는 실제로는 아직 안 뜨지만,
// 백엔드가 나중에 팀 규칙 출처를 내려주면 바로 반영되도록 두 변형 다 구현해둔다.
export function SourceBadge({ source }: { source: RuleSource }) {
  return (
    <span className={`source-badge ${source === 'team' ? 'source-badge-team' : 'source-badge-builtin'}`}>
      {source === 'team' ? '팀 규칙' : '기본 규칙'}
    </span>
  )
}
