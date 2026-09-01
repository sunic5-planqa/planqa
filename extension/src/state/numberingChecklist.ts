import type { NumberingIssueResponse } from '../api/types'

// 🟢 자동 수정 가능 항목만 기본 체크, 🟡 확인 필요 항목은 기본 미체크 — 사용자는 이후 자유롭게
// 토글할 수 있다.
export function deriveDefaultChecked(issues: NumberingIssueResponse[]): Set<string> {
  return new Set(issues.filter((issue) => issue.status === 'auto').map((issue) => issue.id))
}
