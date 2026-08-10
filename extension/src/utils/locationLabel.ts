// 원문 헤딩 자체의 번호는 작성자마다 있기도 없기도 해서 신뢰할 수 없다(실사용 피드백으로 확인됨) —
// 백엔드가 문서 안 등장 순서로 직접 계산해 내려주는 location_number를 우선 쓰고, 원문 텍스트에 이미
// 붙어있는 번호(예: "1. 배경")는 중복 표기("1. 1. 배경")를 피하기 위해 걷어낸다.
// 숫자 뒤에 "." 또는 공백이 바로 이어질 때만 "번호"로 본다 — 그냥 [.\s]* 로는 "2024년 정책"의
// "2024"까지 번호로 오인해서 걷어내 버린다(뒤에 마침표/공백 없이 바로 글자가 이어지므로 번호가
// 아님). [.\s]+ 를 필수로 요구해 이런 오탐을 막는다.
const LEADING_NUMBER_RE = /^\s*\d+(?:[-.]\d+)*[.\s]+/

export function formatLocationLabel(location: string, locationNumber: string | null): string {
  if (!locationNumber) return location
  const label = location.replace(LEADING_NUMBER_RE, '')
  return `${locationNumber}. ${label}`
}
