// 원문 헤딩 자체의 번호는 작성자마다 있기도 없기도 해서 신뢰할 수 없다(실사용 피드백으로 확인됨) —
// 백엔드가 문서 안 등장 순서로 직접 계산해 내려주는 location_number를 우선 쓰고, 원문 텍스트에 이미
// 붙어있는 번호(예: "1. 배경")는 중복 표기("1. 1. 배경")를 피하기 위해 걷어낸다.
// 숫자 뒤에 "." 또는 공백이 바로 이어질 때만 "번호"로 본다 — 그냥 [.\s]* 로는 "2024년 정책"의
// "2024"까지 번호로 오인해서 걷어내 버린다(뒤에 마침표/공백 없이 바로 글자가 이어지므로 번호가
// 아님). [.\s]+ 를 필수로 요구해 이런 오탐을 막는다.
const LEADING_NUMBER_RE = /^\s*\d+(?:[-.]\d+)*[.\s]+/

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

// qa_jobs.py의 _to_issue_record가 XDC(타문서 정합성)의 related_location을 "[문서ID] 섹션"
// 형태로 합성한다(관계형 LG/LF/GA 표시 경로를 재사용하면서 어느 문서 소속인지 구분하기 위함) —
// 그 라벨만으로 "이 related는 같은 문서 안의 두 번째 위치가 아니라 참고문서 쪽"임을 판별한다.
const REFERENCE_LOCATION_RE = /^\[.+\]/
export function isReferenceLocation(location: string | null): boolean {
  return location !== null && REFERENCE_LOCATION_RE.test(location)
}
