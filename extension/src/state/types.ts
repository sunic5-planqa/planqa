import type { IssueAction, IssueResponse, ParsedStructure, QAJobStatusResponse } from '../api/types'

export type Screen = 'main' | 'progress' | 'issues' | 'edit' | 'history'

export type ConfluenceStatus = 'idle' | 'detecting' | 'detected' | 'not_confluence' | 'error'

export type ConfluenceSiblingStatus = 'idle' | 'loading' | 'loaded' | 'no_parent' | 'error'

export interface ConfluenceSiblingDoc {
  id: string
  title: string
}

export interface IssueEdit {
  action: IssueAction
  editedText?: string
}

export interface ReferenceFile {
  id: string
  name: string
  content: string
}

export interface AppState {
  screen: Screen

  confluenceStatus: ConfluenceStatus
  confluencePageTitle: string | null
  confluenceMarkdown: string | null

  confluenceSiblingStatus: ConfluenceSiblingStatus
  confluenceParentTitle: string | null
  confluenceSiblingDocs: ConfluenceSiblingDoc[]
  confluenceSiblingError: string | null

  referenceFiles: ReferenceFile[]
  selectedReferenceFileIds: string[]

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
  screen: 'main',

  confluenceStatus: 'idle',
  confluencePageTitle: null,
  confluenceMarkdown: null,

  confluenceSiblingStatus: 'idle',
  confluenceParentTitle: null,
  confluenceSiblingDocs: [],
  confluenceSiblingError: null,

  referenceFiles: [],
  selectedReferenceFileIds: [],

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
