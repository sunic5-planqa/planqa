import type { IssueResponse } from '../api/types'

export type RuleSource = 'team' | 'builtin'

// 백엔드는 아직 이슈별 "팀 규칙 vs 기본 규칙" 출처를 내려주지 않는다(팀 규칙이라는 개념 자체가
// 백엔드에 없음 — rulebook.py는 기본 룰북 하나뿐). 그래서 지금은 항상 'builtin'을 반환하되, 타입은
// 'team'을 이미 지원해서 나중에 백엔드가 팀 규칙 출처를 내려주기 시작하면 이 함수만 고치면 된다.
export function getRuleSource(_issue: IssueResponse): RuleSource {
  return 'builtin'
}

export function getRuleName(issue: IssueResponse): string {
  return issue.criteria
}

export function getRuleDescription(issue: IssueResponse): string {
  return issue.reason
}

// 예외 상황 텍스트도 백엔드가 안 내려준다(rulebook.py 내부에 exception_text가 있긴 하지만 API
// 응답에서 빠짐) — null을 반환하고, 호출부는 null이면 "예외 상황" 행 자체를 그리지 않아야 한다.
// 빈 문자열이나 가짜 문구로 채우지 않는다.
export function getRuleException(_issue: IssueResponse): string | null {
  return null
}
