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

export const FIXTURE_ISSUES: IssueResponse[] = [
  {
    id: 'fixture-1',
    location: '2장 2문단',
    input_text: '동해의 바다',
    criteria: '용어 및 단어의 일관성',
    reason: "2-2의 '동해의 바다'는 2-1에서 사용된 '동해물'과 동일 의미지만, 다르게 표현되었습니다.",
    suggestion: '동해물',
  },
  {
    id: 'fixture-2',
    location: '3장 1문단',
    input_text: '송은성의 생일은 이때 이뤄질 예정입니다. 모두들 선물을 준비해주세요.',
    criteria: '정보 누락',
    reason: "'이때'가 가리키는 구체적인 날짜가 앞뒤 문단 어디에도 명시되어 있지 않습니다.",
    suggestion: '구체적인 날짜(예: 8월 15일)를 명시해주세요.',
  },
  {
    id: 'fixture-3',
    location: '1장 1문단',
    input_text: '꽃게는 귀엽다',
    criteria: '상위 목표와 세부 내용의 정합성',
    reason: '문서 상단의 목표(고객 설득)와 무관한 주관적 서술이라 상위 목표와 어긋납니다.',
    suggestion: '꽃게가 귀엽다는 소비자 의견이 80% 존재했다',
  },
]
