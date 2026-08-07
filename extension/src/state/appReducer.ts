import type { IssueAction, IssueResponse, ParsedStructure, QAJobStatusResponse } from '../api/types'
import type { AppState, ConfluenceSiblingDoc, ReferenceFile, Screen } from './types'

export type Action =
  | { type: 'DOCUMENT_CREATED'; documentId: string; parsedStructure: ParsedStructure }
  | { type: 'JOB_STARTED'; jobId: string }
  | { type: 'JOB_STATUS_UPDATED'; status: QAJobStatusResponse }
  | { type: 'ISSUES_LOADED'; issues: IssueResponse[] }
  | { type: 'QA_ENGINE_UNAVAILABLE' }
  | { type: 'NAVIGATE'; screen: Screen }
  | { type: 'NAVIGATE_ISSUE'; direction: 'prev' | 'next' }
  | { type: 'SELECT_ISSUE_BY_ID'; issueId: string }
  | { type: 'START_EDIT_ISSUE'; issueId: string }
  | { type: 'STOP_EDIT_ISSUE' }
  | { type: 'STAGE_ISSUE_EDIT'; issueId: string; action: IssueAction; editedText?: string }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'CONFLUENCE_DETECT_START' }
  | { type: 'CONFLUENCE_DETECTED'; title: string; markdown: string }
  | { type: 'CONFLUENCE_NOT_A_PAGE' }
  | { type: 'CONFLUENCE_DETECT_FAILED'; error: string }
  | { type: 'CONFLUENCE_SIBLINGS_DETECT_START' }
  | { type: 'CONFLUENCE_SIBLINGS_LOADED'; docs: ConfluenceSiblingDoc[]; parentTitle: string }
  | { type: 'CONFLUENCE_SIBLINGS_NO_PARENT' }
  | { type: 'CONFLUENCE_SIBLINGS_DETECT_FAILED'; detail: string }
  | { type: 'REFERENCE_FILES_ADDED'; files: ReferenceFile[] }
  | { type: 'REMOVE_REFERENCE_FILE'; fileId: string }

export function appReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'DOCUMENT_CREATED':
      return { ...state, documentId: action.documentId, parsedStructure: action.parsedStructure }

    case 'JOB_STARTED':
      return { ...state, jobId: action.jobId, screen: 'progress' }

    case 'JOB_STATUS_UPDATED':
      return { ...state, jobStatus: action.status }

    case 'ISSUES_LOADED':
      return { ...state, issues: action.issues, currentIssueIndex: 0, editingIssueId: null, issueEdits: {}, screen: 'issues' }

    case 'QA_ENGINE_UNAVAILABLE':
      return { ...state, qaEngineUnavailable: true }

    case 'NAVIGATE':
      return { ...state, screen: action.screen }

    case 'NAVIGATE_ISSUE': {
      const delta = action.direction === 'next' ? 1 : -1
      const nextIndex = Math.min(Math.max(state.currentIssueIndex + delta, 0), Math.max(state.issues.length - 1, 0))
      // 다른 이슈로 넘어가면 진행 중이던 편집은 취소된 것으로 본다 — 저장 안 된 초안을 들고 있다가
      // 나중에 같은 이슈로 돌아왔을 때 예상 못하게 다시 편집 모드로 뜨는 걸 막는다.
      return { ...state, currentIssueIndex: nextIndex, editingIssueId: null }
    }

    case 'SELECT_ISSUE_BY_ID': {
      const index = state.issues.findIndex((issue) => issue.id === action.issueId)
      return index === -1 ? state : { ...state, currentIssueIndex: index, editingIssueId: null }
    }

    case 'START_EDIT_ISSUE':
      return { ...state, editingIssueId: action.issueId }

    case 'STOP_EDIT_ISSUE':
      return { ...state, editingIssueId: null }

    case 'STAGE_ISSUE_EDIT':
      return {
        ...state,
        issueEdits: {
          ...state.issueEdits,
          [action.issueId]: { action: action.action, editedText: action.editedText },
        },
      }

    case 'SET_ERROR':
      return { ...state, error: action.error }

    case 'CONFLUENCE_DETECT_START':
      return { ...state, confluenceStatus: 'detecting' }

    case 'CONFLUENCE_DETECTED':
      return {
        ...state,
        confluenceStatus: 'detected',
        confluencePageTitle: action.title,
        confluenceMarkdown: action.markdown,
      }

    case 'CONFLUENCE_NOT_A_PAGE':
      return { ...state, confluenceStatus: 'not_confluence', confluencePageTitle: null, confluenceMarkdown: null }

    case 'CONFLUENCE_DETECT_FAILED':
      return { ...state, confluenceStatus: 'error', error: action.error }

    case 'CONFLUENCE_SIBLINGS_DETECT_START':
      return { ...state, confluenceSiblingStatus: 'loading' }

    case 'CONFLUENCE_SIBLINGS_LOADED':
      return {
        ...state,
        confluenceSiblingStatus: 'loaded',
        confluenceSiblingDocs: action.docs,
        confluenceParentTitle: action.parentTitle,
      }

    case 'CONFLUENCE_SIBLINGS_NO_PARENT':
      return {
        ...state,
        confluenceSiblingStatus: 'no_parent',
        confluenceSiblingDocs: [],
        confluenceParentTitle: null,
        confluenceSiblingError: null,
      }

    case 'CONFLUENCE_SIBLINGS_DETECT_FAILED':
      return {
        ...state,
        confluenceSiblingStatus: 'error',
        confluenceSiblingDocs: [],
        confluenceParentTitle: null,
        confluenceSiblingError: action.detail,
      }

    case 'REFERENCE_FILES_ADDED':
      return {
        ...state,
        referenceFiles: [...state.referenceFiles, ...action.files],
        selectedReferenceFileIds: [...state.selectedReferenceFileIds, ...action.files.map((f) => f.id)],
      }

    case 'REMOVE_REFERENCE_FILE':
      return {
        ...state,
        referenceFiles: state.referenceFiles.filter((f) => f.id !== action.fileId),
        selectedReferenceFileIds: state.selectedReferenceFileIds.filter((id) => id !== action.fileId),
      }

    default:
      return state
  }
}
