import type { IssueAction, IssueResponse, ParsedStructure, QAJobStatusResponse } from '../api/types'

export type Screen = 'paste' | 'progress' | 'issues' | 'edit' | 'history'

export interface IssueEdit {
  action: IssueAction
  editedText?: string
}

export interface AppState {
  screen: Screen
  rawText: string
  documentId: string | null
  parsedStructure: ParsedStructure | null
  jobId: string | null
  jobStatus: QAJobStatusResponse | null
  issues: IssueResponse[]
  currentIssueIndex: number
  issueEdits: Record<string, IssueEdit>
  qaEngineUnavailable: boolean
  error: string | null
}

export const initialAppState: AppState = {
  screen: 'paste',
  rawText: '',
  documentId: null,
  parsedStructure: null,
  jobId: null,
  jobStatus: null,
  issues: [],
  currentIssueIndex: 0,
  issueEdits: {},
  qaEngineUnavailable: false,
  error: null,
}
