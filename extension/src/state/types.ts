import type {
  IssueAction,
  IssueResponse,
  ParsedStructure,
  QAJobStatusResponse,
  RulebookCategoryResponse,
  TeamRuleResponse,
} from '../api/types'

export type Screen = 'main' | 'loading' | 'progress' | 'issues' | 'history' | 'suggestion-summary' | 'team-rules'

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
  // action이 'skip'일 때 사용자가 남긴 건너뛴 이유 — 기록 화면/충족 현황에서 그대로 보여준다.
  skipReason?: string
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
  // 컨플루언스 자체 페이지 id(URL에서 추출) — 백엔드의 documentId(POST /documents마다 새로
  // 생기는 세션용 UUID)와 달리 새로고침/재방문에도 안 바뀌어서, QA 통과 배지를 백엔드에서
  // 조회할 때 이 값을 조회 키로 쓴다("QA 통과 배지 백엔드 영속화" 기능, 2026-08-30).
  confluencePageId: string | null
  // 문서를 처음 감지했을 때의 탭 id — 마커/스크롤 메시지를 문서 쪽으로 보낼 때 매번
  // chrome.tabs.query({active:true})로 "지금 활성 탭"을 다시 찾으면, 사용자가 다른 탭(복제본
  // 페이지, DevTools 등)에 가 있는 동안 보낸 메시지가 엉뚱한 탭으로 가서 조용히 실패한다(실사용
  // 보고, 2026-08-30 — 마커가 전혀 안 붙는 원인이었음). 감지 시점 탭에 고정해서 보낸다.
  confluenceTabId: number | null

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
  // null이면 3a(목록) 화면, 값이 있으면 3b/3c(상세) 화면 — "지금 작업 중인 제안"을 id로 직접
  // 가리킨다(예전의 인덱스 기반 currentIssueIndex는 이슈 배열이 바뀔 때 범위를 벗어나는 문제가
  // 있었고, 이제는 목록/상세 화면 전환 자체를 이 값의 null 여부로 표현하므로 인덱스가 필요 없다).
  activeIssueId: string | null
  // 관계형 이슈(related_original_text 있음)의 두 위치 중 지금 내비게이터가 가리키는 쪽 — 0=첫
  // 번째 위치, 1=관련 위치. 비관계형 이슈에서는 항상 0으로 취급된다.
  activeLocationIndex: 0 | 1
  issueEdits: Record<string, IssueEdit>
  qaEngineUnavailable: boolean
  error: string | null

  ruleCategories: RulebookCategoryResponse[]
  teamCode: string | null
  teamName: string | null
  teamDescription: string | null
  teamRules: TeamRuleResponse[]
}

export const initialAppState: AppState = {
  screen: 'main',

  confluenceStatus: 'idle',
  confluencePageTitle: null,
  confluenceMarkdown: null,
  confluencePageId: null,
  confluenceTabId: null,

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
  activeIssueId: null,
  activeLocationIndex: 0,
  issueEdits: {},
  qaEngineUnavailable: false,
  error: null,

  ruleCategories: [],
  teamCode: null,
  teamName: null,
  teamDescription: null,
  teamRules: [],
}
