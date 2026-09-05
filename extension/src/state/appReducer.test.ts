import { describe, expect, it } from 'vitest'
import type { IssueResponse, NumberingIssueResponse, TeamRuleResponse } from '../api/types'
import { appReducer } from './appReducer'
import { initialAppState } from './types'

function teamRule(overrides: Partial<TeamRuleResponse> = {}): TeamRuleResponse {
  return {
    id: 'r1',
    rule_name: '규칙명',
    description: '규칙',
    exception_text: null,
    examples: { error1: { error: '', correction: '' }, error2: { error: '', correction: '' }, exception: '' },
    enabled: true,
    scope: 'paragraph',
    ...overrides,
  }
}

describe('appReducer', () => {
  it('ISSUES_LOADED resets active issue and stale edits from a previous review', () => {
    const stale = {
      ...initialAppState,
      activeIssueId: 'old-issue',
      activeLocationIndex: 1 as const,
      issueEdits: { 'old-issue': { action: 'edit' as const, editedText: '이전 리뷰의 수정' } },
    }

    const state = appReducer(stale, { type: 'ISSUES_LOADED', issues: [{ id: 'a' }, { id: 'b' }] as IssueResponse[] })

    expect(state.activeIssueId).toBeNull()
    expect(state.activeLocationIndex).toBe(0)
    expect(state.issueEdits).toEqual({})
    expect(state.screen).toBe('issues')
  })

  // 관계형(LG/LF/GA) 이슈는 두 위치를 독립적으로 편집·저장할 수 있어야 한다 — 한쪽을 저장할 때
  // 다른 쪽에 이미 저장해둔 걸 지워버리면 안 된다.
  it('STAGE_ISSUE_EDIT with target "related" keeps the previously staged primary edit', () => {
    const staged = appReducer(initialAppState, {
      type: 'STAGE_ISSUE_EDIT',
      issueId: 'issue-1',
      action: 'edit',
      editedText: '첫 번째 위치 수정본',
    })

    const state = appReducer(staged, {
      type: 'STAGE_ISSUE_EDIT',
      issueId: 'issue-1',
      action: 'edit',
      target: 'related',
      editedText: '두 번째 위치 수정본',
    })

    expect(state.issueEdits['issue-1']).toEqual({
      action: 'edit',
      editedText: '첫 번째 위치 수정본',
      relatedEditedText: '두 번째 위치 수정본',
      skipReason: undefined,
    })
  })

  it('STAGE_ISSUE_EDIT with target "primary" (default) keeps a previously staged related edit', () => {
    const staged = appReducer(initialAppState, {
      type: 'STAGE_ISSUE_EDIT',
      issueId: 'issue-1',
      action: 'edit',
      target: 'related',
      editedText: '두 번째 위치 수정본',
    })

    const state = appReducer(staged, {
      type: 'STAGE_ISSUE_EDIT',
      issueId: 'issue-1',
      action: 'edit',
      editedText: '첫 번째 위치 수정본',
    })

    expect(state.issueEdits['issue-1']).toEqual({
      action: 'edit',
      editedText: '첫 번째 위치 수정본',
      relatedEditedText: '두 번째 위치 수정본',
      skipReason: undefined,
    })
  })

  it('FINALIZE_UNRESOLVED_AS_SKIPPED skips only untouched issues, never overwriting resolved ones', () => {
    const state = {
      ...initialAppState,
      issues: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }] as IssueResponse[],
      issueEdits: {
        a: { action: 'apply' as const },
        b: { action: 'skip' as const, skipReason: '이번엔 안 함' },
        c: { action: 'edit' as const, editedText: '수정본' },
      },
    }

    const next = appReducer(state, { type: 'FINALIZE_UNRESOLVED_AS_SKIPPED' })

    expect(next.issueEdits).toEqual({
      a: { action: 'apply' },
      b: { action: 'skip', skipReason: '이번엔 안 함' },
      c: { action: 'edit', editedText: '수정본' },
      d: { action: 'skip' },
    })
  })

  it('FINALIZE_UNRESOLVED_AS_SKIPPED is a no-op when every issue is already resolved', () => {
    const edits = { a: { action: 'apply' as const }, b: { action: 'skip' as const } }
    const state = { ...initialAppState, issues: [{ id: 'a' }, { id: 'b' }] as IssueResponse[], issueEdits: edits }

    const next = appReducer(state, { type: 'FINALIZE_UNRESOLVED_AS_SKIPPED' })

    expect(next.issueEdits).toEqual(edits)
  })

  it('RESET_QA_SESSION clears the QA session but keeps confluence detection and team state', () => {
    const state = {
      ...initialAppState,
      screen: 'issues' as const,
      documentId: 'doc-1',
      jobId: 'job-1',
      issues: [{ id: 'a' }] as IssueResponse[],
      issueEdits: { a: { action: 'apply' as const } },
      activeIssueId: 'a',
      numberingIssues: [{ id: 'n1' }] as NumberingIssueResponse[],
      confluencePageId: '12345',
      confluenceTabId: 7,
      teamCode: 'ABC123',
      teamRules: [teamRule()],
    }

    const next = appReducer(state, { type: 'RESET_QA_SESSION' })

    expect(next.documentId).toBeNull()
    expect(next.jobId).toBeNull()
    expect(next.issues).toEqual([])
    expect(next.issueEdits).toEqual({})
    expect(next.activeIssueId).toBeNull()
    expect(next.numberingIssues).toEqual([])
    // 세션 밖 상태는 유지 — 다시검사 후 문서 재감지/팀 재연결이 필요 없어야 한다.
    expect(next.confluencePageId).toBe('12345')
    expect(next.confluenceTabId).toBe(7)
    expect(next.teamCode).toBe('ABC123')
    expect(next.teamRules).toHaveLength(1)
  })

  it('NUMBERING_ISSUES_LOADED with an empty list still switches to the numbering-check screen', () => {
    const state = appReducer({ ...initialAppState, screen: 'suggestion-summary' }, {
      type: 'NUMBERING_ISSUES_LOADED',
      issues: [],
    })

    expect(state.numberingIssues).toEqual([])
    expect(state.screen).toBe('numbering-check')
  })

  it('NUMBERING_ISSUES_LOADED stores the issues and switches to the numbering-check screen', () => {
    const issues: NumberingIssueResponse[] = [
      {
        id: 'n1',
        status: 'auto',
        sub_type: 'missing',
        location: '3. 해결 방안',
        problem: '번호 누락',
        before_text: '4. 해결 방안',
        after_text: '3. 해결 방안',
      },
    ]

    const state = appReducer({ ...initialAppState, screen: 'issues' }, { type: 'NUMBERING_ISSUES_LOADED', issues })

    expect(state.numberingIssues).toEqual(issues)
    expect(state.screen).toBe('numbering-check')
  })

  it('STAGE_ISSUE_EDIT with a skipReason persists it, and a later stage without one keeps it', () => {
    const skipped = appReducer(initialAppState, {
      type: 'STAGE_ISSUE_EDIT',
      issueId: 'issue-1',
      action: 'skip',
      skipReason: '이번 릴리스에서는 다루지 않기로 함',
    })

    expect(skipped.issueEdits['issue-1'].skipReason).toBe('이번 릴리스에서는 다루지 않기로 함')

    const restaged = appReducer(skipped, { type: 'STAGE_ISSUE_EDIT', issueId: 'issue-1', action: 'apply' })

    expect(restaged.issueEdits['issue-1'].skipReason).toBe('이번 릴리스에서는 다루지 않기로 함')
  })

  it('UNSTAGE_ISSUE_EDIT removes the issue from issueEdits entirely ("되돌리기")', () => {
    const staged = appReducer(initialAppState, { type: 'STAGE_ISSUE_EDIT', issueId: 'issue-1', action: 'apply' })
    expect(staged.issueEdits['issue-1']).toBeDefined()

    const state = appReducer(staged, { type: 'UNSTAGE_ISSUE_EDIT', issueId: 'issue-1' })

    expect(state.issueEdits['issue-1']).toBeUndefined()
  })

  it('CONFLUENCE_DETECTED sets title, markdown, pageId, tabId, and status', () => {
    const state = appReducer(initialAppState, {
      type: 'CONFLUENCE_DETECTED',
      title: '기획서',
      markdown: '# 기획서',
      pageId: '12345',
      tabId: 7,
    })

    expect(state.confluenceStatus).toBe('detected')
    expect(state.confluencePageTitle).toBe('기획서')
    expect(state.confluenceMarkdown).toBe('# 기획서')
    expect(state.confluencePageId).toBe('12345')
    expect(state.confluenceTabId).toBe(7)
  })

  it('CONFLUENCE_NOT_A_PAGE clears title/markdown/pageId/tabId', () => {
    const detected = appReducer(initialAppState, {
      type: 'CONFLUENCE_DETECTED',
      title: '기획서',
      markdown: '# 기획서',
      pageId: '12345',
      tabId: 7,
    })

    const state = appReducer(detected, { type: 'CONFLUENCE_NOT_A_PAGE' })

    expect(state.confluenceStatus).toBe('not_confluence')
    expect(state.confluencePageTitle).toBeNull()
    expect(state.confluenceMarkdown).toBeNull()
    expect(state.confluencePageId).toBeNull()
    expect(state.confluenceTabId).toBeNull()
  })

  it('CONFLUENCE_SIBLINGS_LOADED stores the sibling docs', () => {
    const loading = appReducer(initialAppState, { type: 'CONFLUENCE_SIBLINGS_DETECT_START' })
    expect(loading.confluenceSiblingStatus).toBe('loading')

    const state = appReducer(loading, {
      type: 'CONFLUENCE_SIBLINGS_LOADED',
      docs: [{ id: '2', title: 'DOC-002' }],
      parentTitle: '기획서 더미 문서함',
    })

    expect(state.confluenceSiblingStatus).toBe('loaded')
    expect(state.confluenceSiblingDocs).toEqual([{ id: '2', title: 'DOC-002' }])
    expect(state.confluenceParentTitle).toBe('기획서 더미 문서함')
  })

  it('CONFLUENCE_SIBLINGS_NO_PARENT clears any previously loaded docs', () => {
    const loaded = appReducer(initialAppState, {
      type: 'CONFLUENCE_SIBLINGS_LOADED',
      docs: [{ id: '2', title: 'DOC-002' }],
      parentTitle: '기획서 더미 문서함',
    })

    const state = appReducer(loaded, { type: 'CONFLUENCE_SIBLINGS_NO_PARENT' })

    expect(state.confluenceSiblingStatus).toBe('no_parent')
    expect(state.confluenceSiblingDocs).toEqual([])
    expect(state.confluenceParentTitle).toBeNull()
  })

  it('REFERENCE_FILES_ADDED appends files and auto-selects them', () => {
    const state = appReducer(initialAppState, {
      type: 'REFERENCE_FILES_ADDED',
      files: [{ id: 'f1', name: 'a.md', content: '# a' }],
    })

    expect(state.referenceFiles).toEqual([{ id: 'f1', name: 'a.md', content: '# a' }])
    expect(state.selectedReferenceFileIds).toEqual(['f1'])
  })

  it('REMOVE_REFERENCE_FILE drops the file and its selection', () => {
    const added = appReducer(initialAppState, {
      type: 'REFERENCE_FILES_ADDED',
      files: [{ id: 'f1', name: 'a.md', content: '# a' }],
    })

    const state = appReducer(added, { type: 'REMOVE_REFERENCE_FILE', fileId: 'f1' })

    expect(state.referenceFiles).toEqual([])
    expect(state.selectedReferenceFileIds).toEqual([])
  })

  it('SELECT_ISSUE_BY_ID sets the active issue and resets the location index', () => {
    const withIssues = {
      ...initialAppState,
      issues: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] as IssueResponse[],
      activeIssueId: 'a',
      activeLocationIndex: 1 as const,
    }

    const state = appReducer(withIssues, { type: 'SELECT_ISSUE_BY_ID', issueId: 'c' })

    expect(state.activeIssueId).toBe('c')
    expect(state.activeLocationIndex).toBe(0)
  })

  it('CLEAR_ACTIVE_ISSUE resets to the list view (3a)', () => {
    const inDetail = {
      ...initialAppState,
      activeIssueId: 'a',
      activeLocationIndex: 1 as const,
    }

    const state = appReducer(inDetail, { type: 'CLEAR_ACTIVE_ISSUE' })

    expect(state.activeIssueId).toBeNull()
    expect(state.activeLocationIndex).toBe(0)
  })

  it('CYCLE_ACTIVE_LOCATION toggles between 0 and 1', () => {
    const toRelated = appReducer(initialAppState, { type: 'CYCLE_ACTIVE_LOCATION' })
    expect(toRelated.activeLocationIndex).toBe(1)

    const backToPrimary = appReducer(toRelated, { type: 'CYCLE_ACTIVE_LOCATION' })
    expect(backToPrimary.activeLocationIndex).toBe(0)
  })

  it('TEAM_CONNECTED stores the team code, name, and description', () => {
    const state = appReducer(initialAppState, {
      type: 'TEAM_CONNECTED',
      team: { team_code: 'ABC123', team_name: '서비스기획 2팀', description: '설명' },
    })

    expect(state.teamCode).toBe('ABC123')
    expect(state.teamName).toBe('서비스기획 2팀')
    expect(state.teamDescription).toBe('설명')
  })

  it('TEAM_RULES_LOADED replaces the team rule list', () => {
    const rules = [teamRule()]

    const state = appReducer(initialAppState, { type: 'TEAM_RULES_LOADED', rules })

    expect(state.teamRules).toEqual(rules)
  })

  it('TEAM_RULE_ADDED appends a rule', () => {
    const rule = teamRule()

    const state = appReducer(initialAppState, { type: 'TEAM_RULE_ADDED', rule })

    expect(state.teamRules).toEqual([rule])
  })

  it('TEAM_RULE_UPDATED replaces the matching rule in place', () => {
    const original = teamRule({ description: '원본' })
    const updated = teamRule({ description: '수정됨' })
    const withRule = { ...initialAppState, teamRules: [original] }

    const state = appReducer(withRule, { type: 'TEAM_RULE_UPDATED', rule: updated })

    expect(state.teamRules).toEqual([updated])
  })

  it('TEAM_RULE_DELETED removes the matching rule', () => {
    const rule = teamRule()
    const withRule = { ...initialAppState, teamRules: [rule] }

    const state = appReducer(withRule, { type: 'TEAM_RULE_DELETED', ruleId: 'r1' })

    expect(state.teamRules).toEqual([])
  })
})
