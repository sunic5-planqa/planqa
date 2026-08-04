import type { IssueResponse, QAJobStatusResponse } from './types'

// QA 엔진(백엔드 qa_engine/)이 구현되기 전까지 화면 흐름을 데모/검토할 수 있도록 하는 로컬 목데이터.
// 실제 엔드포인트가 501을 반환할 때만 폴백으로 쓰인다 — 응답 스키마는 실제 백엔드 타입과 동일.

export const FIXTURE_JOB_STATUS: QAJobStatusResponse = {
  status: 'done',
  progress: 100,
  current_category: '문장',
  elapsed_seconds: 4.2,
}

export const FIXTURE_ISSUES: IssueResponse[] = [
  {
    id: 'fixture-1',
    location: '1장 배경 1문단 2문장',
    input_text: '자동화가 필요합니다.',
    criteria: '논리 비약',
    reason: '왜 자동화가 필요한지 근거가 앞 문장과 연결되지 않습니다.',
    suggestion: '기존 수동 QA의 소요 시간/오류율 등 구체적 근거를 추가해주세요.',
  },
  {
    id: 'fixture-2',
    location: '2장 목표 1문단 1문장',
    input_text: '문서 구조 파싱',
    criteria: '용어 일관성',
    reason: "다른 문단에서는 '구조 분석'이라는 표현을 사용하고 있어 용어가 혼용됩니다.",
    suggestion: "'구조 분석'으로 통일하는 것을 제안합니다.",
  },
]
