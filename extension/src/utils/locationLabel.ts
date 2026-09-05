// 원문 헤딩 자체의 번호는 작성자마다 있기도 없기도 해서 신뢰할 수 없다(실사용 피드백으로 확인됨) —
// 백엔드가 문서 안 등장 순서로 직접 계산해 내려주는 location_number를 우선 쓰고, 원문 텍스트에 이미
// 붙어있는 번호(예: "1. 배경")는 중복 표기("1. 1. 배경")를 피하기 위해 걷어낸다.
// 숫자 뒤에 "." 또는 공백이 바로 이어질 때만 "번호"로 본다 — 그냥 [.\s]* 로는 "2024년 정책"의
// "2024"까지 번호로 오인해서 걷어내 버린다(뒤에 마침표/공백 없이 바로 글자가 이어지므로 번호가
// 아님). [.\s]+ 를 필수로 요구해 이런 오탐을 막는다.
// extension 쪽에서 이 조건이 필요한 곳(issueOverlay.ts 포함)은 전부 여기서 export한 것을 가져다
// 쓴다 — 정규식을 여기저기 복붙하면 나중에 조건을 바꿀 때 한 곳을 빼먹기 쉽다. 백엔드
// numbering_validation.py의 _NUMBER_RE는 언어가 달라 공유할 수 없으니 그쪽은 별도로 동일하게
// 맞춰 유지해야 한다(그 파일 주석에서 여기를 가리킨다).
export const LEADING_NUMBER_RE = /^\s*\d+(?:[-.]\d+)*[.\s]+/

// 백엔드 location은 "상위 위계 > 하위 위계" 체인으로 내려온다(qa_jobs.py / numbering_validation.py).
// 사용자에게는 H1 전체 경로가 아니라 오류가 실제로 속한 가장 안쪽 제목만 보여준다 — 예: "발송 정책
// > 발송 채널" → "발송 채널"(+ 번호가 있으면 "3-2. 발송 채널").
export function locationLeaf(location: string): string {
  const parts = location.split('>')
  return (parts[parts.length - 1] ?? location).trim()
}

export function formatLocationLabel(location: string, locationNumber: string | null): string {
  const leaf = locationLeaf(location)
  if (!locationNumber) return leaf
  return `${locationNumber}. ${leaf.replace(LEADING_NUMBER_RE, '')}`
}
