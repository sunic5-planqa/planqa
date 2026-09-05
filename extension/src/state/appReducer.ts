import type {
  IssueAction,
  IssueResponse,
  NumberingIssueResponse,
  ParsedStructure,
  QAJobStatusResponse,
  TeamResponse,
  TeamRuleResponse,
} from '../api/types'
import type { AppState, ConfluenceSiblingDoc, ReferenceFile, Screen } from './types'
import { initialAppState } from './types'

export type Action =
  | { type: 'DOCUMENT_CREATED'; documentId: string; parsedStructure: ParsedStructure }
  | { type: 'JOB_STARTED'; jobId: string }
  | { type: 'JOB_STATUS_UPDATED'; status: QAJobStatusResponse }
  | { type: 'ISSUES_LOADED'; issues: IssueResponse[] }
  | { type: 'NUMBERING_ISSUES_LOADED'; issues: NumberingIssueResponse[] }
  | { type: 'QA_ENGINE_UNAVAILABLE' }
  | { type: 'NAVIGATE'; screen: Screen }
  | { type: 'SELECT_ISSUE_BY_ID'; issueId: string }
  | { type: 'CLEAR_ACTIVE_ISSUE' }
  | { type: 'CYCLE_ACTIVE_LOCATION' }
  | { type: 'FINALIZE_UNRESOLVED_AS_SKIPPED' }
  | { type: 'RESET_QA_SESSION' }
  | {
      type: 'STAGE_ISSUE_EDIT'
      issueId: string
      action: IssueAction
      target?: 'primary' | 'related'
      editedText?: string
      skipReason?: string
    }
  | { type: 'UNSTAGE_ISSUE_EDIT'; issueId: string }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'CONFLUENCE_DETECT_START' }
  | { type: 'CONFLUENCE_DETECTED'; title: string; markdown: string; pageId: string; tabId: number }
  | { type: 'CONFLUENCE_NOT_A_PAGE' }
  | { type: 'CONFLUENCE_DETECT_FAILED'; error: string }
  | { type: 'CONFLUENCE_SIBLINGS_DETECT_START' }
  | { type: 'CONFLUENCE_SIBLINGS_LOADED'; docs: ConfluenceSiblingDoc[]; parentTitle: string }
  | { type: 'CONFLUENCE_SIBLINGS_NO_PARENT' }
  | { type: 'CONFLUENCE_SIBLINGS_DETECT_FAILED'; detail: string }
  | { type: 'REFERENCE_FILES_ADDED'; files: ReferenceFile[] }
  | { type: 'REMOVE_REFERENCE_FILE'; fileId: string }
  | { type: 'TEAM_CONNECTED'; team: TeamResponse }
  | { type: 'TEAM_RULES_LOADED'; rules: TeamRuleResponse[] }
  | { type: 'TEAM_RULE_ADDED'; rule: TeamRuleResponse }
  | { type: 'TEAM_RULE_UPDATED'; rule: TeamRuleResponse }
  | { type: 'TEAM_RULE_DELETED'; ruleId: string }

export function appReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'DOCUMENT_CREATED':
      return { ...state, documentId: action.documentId, parsedStructure: action.parsedStructure }

    case 'JOB_STARTED':
      return { ...state, jobId: action.jobId, screen: 'progress' }

    case 'JOB_STATUS_UPDATED':
      return { ...state, jobStatus: action.status }

    case 'ISSUES_LOADED':
      return {
        ...state,
        issues: action.issues,
        activeIssueId: null,
        activeLocationIndex: 0,
        issueEdits: {},
        screen: 'issues',
      }

    // 넘버링 하모나이징은 QA의 마지막 사용자 확인 단계다 — 오류가 0건이어도 호출부(finishQA)가
    // 빈 배열로 이 액션을 dispatch해서 반드시 이 화면에 진입한다. 적용 후 재검증도 같은 액션을 쓴다.
    case 'NUMBERING_ISSUES_LOADED':
      return { ...state, numberingIssues: action.issues, screen: 'numbering-check' }

    case 'QA_ENGINE_UNAVAILABLE':
      return { ...state, qaEngineUnavailable: true }

    case 'NAVIGATE':
      return { ...state, screen: action.screen }

    case 'SELECT_ISSUE_BY_ID':
      // 다른 제안으로 넘어가면 진행 중이던 위치 순회는 초기화한다 — 예전엔 진행 중이던 편집도
      // 같이 초기화했지만, 편집은 이제 왼쪽 문서에서만 일어나(SuggestionDirectionCard의 텍스트
      // 영역 폴백은 제거됨, 2026-08-30) 패널 쪽엔 초기화할 편집 상태가 없다.
      return { ...state, activeIssueId: action.issueId, activeLocationIndex: 0 }

    case 'CLEAR_ACTIVE_ISSUE':
      return { ...state, activeIssueId: null, activeLocationIndex: 0 }

    case 'CYCLE_ACTIVE_LOCATION':
      return { ...state, activeLocationIndex: state.activeLocationIndex === 0 ? 1 : 0 }

    // "수정완료" — 사용자가 손대지 않은 이슈(issueEdits 엔트리 없음)만 건너뜀으로 확정한다. 이미
    // apply/edit/skip으로 처리한 이슈의 상태(사유 포함)는 절대 덮어쓰지 않는다.
    case 'FINALIZE_UNRESOLVED_AS_SKIPPED': {
      const issueEdits = { ...state.issueEdits }
      for (const issue of state.issues) {
        if (issueEdits[issue.id] === undefined) issueEdits[issue.id] = { action: 'skip' }
      }
      return { ...state, issueEdits }
    }

    // "다시검사" — 우리 서비스 내부의 QA 세션/처리 상태만 비운다. 문서 감지(confluence*), 팀
    // 연결(teamCode/teamRules), 참고문서는 그대로 두고, 이미 Confluence 문서에 적용된 수정도
    // 당연히 안 건드린다. 이후 main에서 "QA 시작"을 누르면 현재 문서로 새 검토가 돈다.
    case 'RESET_QA_SESSION':
      return {
        ...state,
        documentId: initialAppState.documentId,
        parsedStructure: initialAppState.parsedStructure,
        jobId: initialAppState.jobId,
        jobStatus: initialAppState.jobStatus,
        issues: initialAppState.issues,
        numberingIssues: initialAppState.numberingIssues,
        activeIssueId: initialAppState.activeIssueId,
        activeLocationIndex: initialAppState.activeLocationIndex,
        issueEdits: initialAppState.issueEdits,
        qaEngineUnavailable: initialAppState.qaEngineUnavailable,
        error: initialAppState.error,
      }

    case 'STAGE_ISSUE_EDIT': {
      // target이 'related'면 relatedEditedText만 갱신하고 editedText(첫 번째 위치)는 기존 값을
      // 그대로 유지한다(반대도 마찬가지) — 두 위치를 독립적으로 편집·저장할 수 있어야 하므로 한
      // 쪽을 저장할 때 다른 쪽에 저장해둔 걸 지워버리면 안 된다.
      const existing = state.issueEdits[action.issueId]
      const target = action.target ?? 'primary'
      const skipReason = action.skipReason ?? existing?.skipReason
      const updated =
        target === 'related'
          ? { action: action.action, editedText: existing?.editedText, relatedEditedText: action.editedText, skipReason }
          : { action: action.action, editedText: action.editedText, relatedEditedText: existing?.relatedEditedText, skipReason }
      return { ...state, issueEdits: { ...state.issueEdits, [action.issueId]: updated } }
    }

    case 'UNSTAGE_ISSUE_EDIT': {
      // 완료/건너뜀 카드의 "되돌리기" — 해당 이슈를 다시 미해결 상태로 되돌린다.
      const { [action.issueId]: _removed, ...rest } = state.issueEdits
      return { ...state, issueEdits: rest }
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
        confluencePageId: action.pageId,
        confluenceTabId: action.tabId,
      }

    case 'CONFLUENCE_NOT_A_PAGE':
      return {
        ...state,
        confluenceStatus: 'not_confluence',
        confluencePageTitle: null,
        confluenceMarkdown: null,
        confluencePageId: null,
        confluenceTabId: null,
      }

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

    case 'TEAM_CONNECTED':
      return {
        ...state,
        teamCode: action.team.team_code,
        teamName: action.team.team_name,
        teamDescription: action.team.description,
      }

    case 'TEAM_RULES_LOADED':
      return { ...state, teamRules: action.rules }

    case 'TEAM_RULE_ADDED':
      return { ...state, teamRules: [...state.teamRules, action.rule] }

    case 'TEAM_RULE_UPDATED':
      return { ...state, teamRules: state.teamRules.map((rule) => (rule.id === action.rule.id ? action.rule : rule)) }

    case 'TEAM_RULE_DELETED':
      return { ...state, teamRules: state.teamRules.filter((rule) => rule.id !== action.ruleId) }

    default:
      return state
  }
}
