import type { ReferenceFile } from '../state/types'

// XDC(타문서 정합성) 이슈의 related_location은 백엔드가 "[문서 제목] 위치"로 내려준다
// (qa_jobs.py _to_issue_record) — 관계형(LG/LF/GA, 같은 문서 안) related_location은 "["로
// 시작하지 않으니 그대로 null. 그 제목으로 이번 검토에서 실제로 선택한 참고문서
// (referenceFiles — 컨플루언스 페이지 id를 이미 갖고 있음)를 찾아 새 탭으로 열 수 있게 한다.
export function findReferenceDocumentId(relatedLocation: string, referenceFiles: ReferenceFile[]): string | null {
  const match = /^\[([^\]]+)\]/.exec(relatedLocation)
  if (!match) return null
  const title = match[1]
  return referenceFiles.find((file) => file.name === title)?.id ?? null
}
