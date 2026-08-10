import type { IssueAction, IssueResponse, ParsedStructure, QAJobStatusResponse } from '../api/types'

export type Screen = 'main' | 'loading' | 'progress' | 'issues' | 'history'

export type ConfluenceStatus = 'idle' | 'detecting' | 'detected' | 'not_confluence' | 'error'

export type ConfluenceSiblingStatus = 'idle' | 'loading' | 'loaded' | 'no_parent' | 'error'

export interface ConfluenceSiblingDoc {
  id: string
  title: string
}

export interface IssueEdit {
  action: IssueAction
  editedText?: string
  // LG/LF/GA(관계형) 이슈의 두 번째 위치(related_location) 원문을 별도로 편집·저장한 결과 —
  // 첫 번째 위치(editedText)와 독립적으로 채워질 수 있다(둘 중 하나만 고쳐도 저장 가능).
  relatedEditedText?: string
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
  editingIssueId: string | null
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
  editingIssueId: null,
  qaEngineUnavailable: false,
  error: null,
}
