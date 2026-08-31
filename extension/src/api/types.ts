export interface Sentence {
  id: string
  text: string
  start: number
  end: number
}

export interface Paragraph {
  id: string
  sentences: Sentence[]
  start: number
  end: number
}

export interface Chapter {
  id: string
  title: string
  paragraphs: Paragraph[]
  start: number
  end: number
}

export interface ParsedStructure {
  title: string | null
  chapters: Chapter[]
}

export interface CreateDocumentResponse {
  document_id: string
  parsed_structure: ParsedStructure
}

export interface CreateQAJobResponse {
  job_id: string
}

export interface CreateQAJobRequest {
  team_code?: string | null
}

export type CategoryItemStatus = 'pending' | 'in_progress' | 'done'

export interface CategoryItem {
  key: string
  label: string
  status: CategoryItemStatus
}

export interface ProgressCategory {
  key: string
  label: string
  items: CategoryItem[]
}

export interface QAJobStatusResponse {
  status: string
  progress: number
  current_category: string | null
  elapsed_seconds: number
  categories?: ProgressCategory[]
}

// object: 오류 위치 하나만(TC/TM/AE/RD). insert_range: 정보 누락 자리를 포함하는 최소 상위 위계(MI).
// range: location~related_location 사이 전체(LG/LF/GA — related_location 없으면 object로 내려옴).
// 문서 위 하이라이트 박스를 실제로 그 모양대로 그리는 건 아직 구현 안 됨(issueOverlay.ts는 지금도
// object 방식으로만 그림) — 백엔드가 값을 내려주기 시작한 것뿐, 다음 단계에서 issueOverlay.ts가
// range/insert_range를 처리하도록 확장해야 함.
export type FrameType = 'object' | 'range' | 'insert_range'

export interface IssueResponse {
  id: string
  location: string
  location_number: string | null
  input_text: string
  criteria: string
  reason: string
  suggestion: string
  frame_type: FrameType
  related_location: string | null
  related_original_text: string | null
}

export type IssueAction = 'apply' | 'skip' | 'edit'

export interface UpdateIssueRequest {
  action: IssueAction
  edited_text?: string
}

export interface UpdateIssueResponse {
  id: string
  status: string
}

export interface SimilarityCheckResponse {
  addresses_issue: boolean
  reason: string
}

export interface ExportDocumentResponse {
  export_text: string
}

export interface DocumentCountResponse {
  count: number
}

export interface RulebookCategoryResponse {
  category: string
  label: string
}

export interface TeamResponse {
  team_code: string
  team_name: string
  description: string
}

export interface CreateTeamRequest {
  team_name: string
  description: string
}

export interface RuleExamplePair {
  error: string
  correction: string
}

export interface TeamRuleExamples {
  error1: RuleExamplePair
  error2: RuleExamplePair
  exception: string
}

export interface TeamRuleResponse {
  id: string
  rule_name: string
  description: string
  exception_text: string | null
  examples: TeamRuleExamples
  enabled: boolean
}

export interface TeamRuleInput {
  rule_name: string
  description: string
  exception_text?: string | null
  examples: TeamRuleExamples
  enabled: boolean
}

export type NumberingIssueStatus = 'auto' | 'confirm'
export type NumberingIssueSubType = 'missing' | 'duplicate' | 'order' | 'ambiguous'

export interface NumberingIssueResponse {
  id: string
  status: NumberingIssueStatus
  sub_type: NumberingIssueSubType
  location: string
  problem: string
  before_text: string
  after_text: string | null
}

export interface AppliedNumberingFix {
  before_text: string
  after_text: string
}
