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

export interface IssueResponse {
  id: string
  location: string
  input_text: string
  criteria: string
  reason: string
  suggestion: string
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

export interface ExportDocumentResponse {
  export_text: string
}

export interface DocumentCountResponse {
  count: number
}
