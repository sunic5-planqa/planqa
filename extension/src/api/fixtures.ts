import type { CategoryItem, IssueResponse, ProgressCategory, QAJobStatusResponse } from './types'

// QA 엔진(백엔드 qa_engine/)이 구현되기 전까지 화면 흐름을 데모/검토할 수 있도록 하는 로컬 목데이터.
// 실제 엔드포인트가 501을 반환할 때만 폴백으로 쓰인다 — 응답 스키마는 실제 백엔드 타입과 동일.
// categories는 아직 백엔드가 채워주지 않는 필드라 fixture에만 존재한다.

const CRITERIA_LABELS = [
  '논리 비약',
  '논리 흐름',
  '정보 누락',
  '상위 목표와 세부 내용의 정합성',
  '용어 및 단어의 일관성',
  '용어 오용',
  '모호한 표현',
  '불필요한 중복',
]

function buildItems(inProgressLabel?: string, doneCount = CRITERIA_LABELS.length): CategoryItem[] {
  return CRITERIA_LABELS.map((label, idx) => ({
    key: label,
    label,
    status: label === inProgressLabel ? 'in_progress' : idx < doneCount ? 'done' : 'pending',
  }))
}

const FIXTURE_CATEGORIES: ProgressCategory[] = [
  { key: 'documents', label: 'Documents', items: buildItems() },
  { key: 'logical_chapter', label: 'Logical Chapter', items: buildItems('불필요한 중복') },
  { key: 'detailed_chapter', label: 'Detailed Chapter', items: buildItems(undefined, 0) },
  { key: 'sentence', label: 'Sentence', items: buildItems(undefined, 0) },
]

export const FIXTURE_JOB_STATUS: QAJobStatusResponse = {
  status: 'done',
  progress: 30,
  current_category: '불필요한 중복',
  elapsed_seconds: 20,
  categories: FIXTURE_CATEGORIES,
}

// backend의 /mock-confluence 목 문서("결제 시스템 개선 기획서")와 문구가 그대로 맞아떨어지도록 맞춘 이슈.
// input_text/suggestion이 실제 렌더링된 문서 텍스트와 정확히 일치해야 인라인 오버레이(useIssueOverlaySync)가
// 본문에서 해당 구간을 찾아 하이라이트할 수 있다.
export const FIXTURE_ISSUES: IssueResponse[] = [
  {
    id: 'fixture-1',
    location: '2장 배경 및 문제 정의',
    input_text: '간편결제(카카오페이, 네이버페이, 토스) 3사만 지원, 페이코 미지원',
    criteria: '용어 및 단어의 일관성',
    reason:
      "2장의 간편결제 지원사가 3사로 명시됐지만, 4장 요구사항에서는 페이코·삼성페이 추가 연동이 언급되어 실제 지원 수단 수와 표현이 일치하지 않습니다.",
    suggestion: '간편결제(카카오페이, 네이버페이, 토스, 삼성페이) 4사만 지원, 페이코 미지원',
    frame_type: 'object',
    related_location: null,
  },
  {
    id: 'fixture-2',
    location: '2장 배경 및 문제 정의',
    input_text: 'PG사 응답 지연 시 타임아웃 처리 로직 부재',
    criteria: '상위 목표와 세부 내용의 정합성',
    reason: "4장 '실패 처리 개선' 요구사항에는 타임아웃 재시도가 포함되어 있지만, 배경 항목에는 재시도 로직 언급이 빠져 있습니다.",
    suggestion: 'PG사 응답 지연 시 자동 타임아웃 및 재시도 로직 부재',
    frame_type: 'object',
    related_location: null,
  },
  {
    id: 'fixture-3',
    location: '3장 목표',
    input_text: '간편결제 지원 수단을 4종에서 7종으로 확대한다',
    criteria: '정보 누락',
    reason: '목표(3장)와 주요 요구사항 표(4장)에 적힌 간편결제 확대 목표 수치가 서로 달라 어느 쪽이 최신 값인지 확인이 필요합니다.',
    suggestion: '간편결제 지원 수단을 4종에서 8종으로 확대한다',
    frame_type: 'insert_range',
    related_location: null,
  },
]
