import type { IssueAction, IssueResponse, ParsedStructure, QAJobStatusResponse } from '../api/types'
import type { AppState, Screen } from './types'

export type Action =
  | { type: 'SET_RAW_TEXT'; rawText: string }
  | { type: 'DOCUMENT_CREATED'; documentId: string; parsedStructure: ParsedStructure }
  | { type: 'JOB_STARTED'; jobId: string }
  | { type: 'JOB_STATUS_UPDATED'; status: QAJobStatusResponse }
  | { type: 'ISSUES_LOADED'; issues: IssueResponse[] }
  | { type: 'QA_ENGINE_UNAVAILABLE' }
  | { type: 'NAVIGATE'; screen: Screen }
  | { type: 'NAVIGATE_ISSUE'; direction: 'prev' | 'next' }
  | { type: 'STAGE_ISSUE_EDIT'; issueId: string; action: IssueAction; editedText?: string }
  | { type: 'SET_ERROR'; error: string | null }

export function appReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_RAW_TEXT':
      return { ...state, rawText: action.rawText }

    case 'DOCUMENT_CREATED':
      return { ...state, documentId: action.documentId, parsedStructure: action.parsedStructure }

    case 'JOB_STARTED':
      return { ...state, jobId: action.jobId, screen: 'progress' }

    case 'JOB_STATUS_UPDATED':
      return { ...state, jobStatus: action.status }

    case 'ISSUES_LOADED':
      return { ...state, issues: action.issues, currentIssueIndex: 0, screen: 'issues' }

    case 'QA_ENGINE_UNAVAILABLE':
      return { ...state, qaEngineUnavailable: true }

    case 'NAVIGATE':
      return { ...state, screen: action.screen }

    case 'NAVIGATE_ISSUE': {
      const delta = action.direction === 'next' ? 1 : -1
      const nextIndex = Math.min(Math.max(state.currentIssueIndex + delta, 0), Math.max(state.issues.length - 1, 0))
      return { ...state, currentIssueIndex: nextIndex }
    }

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

    default:
      return state
  }
}
