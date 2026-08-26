import { describe, expect, it } from 'vitest'
import type { IssueResponse, TeamRuleResponse } from '../api/types'
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
    ...overrides,
  }
}

describe('appReducer', () => {
  it('ISSUES_LOADED resets index, editing state, and stale edits from a previous review', () => {
    const stale = {
      ...initialAppState,
      currentIssueIndex: 2,
      editingIssueId: 'old-issue',
      issueEdits: { 'old-issue': { action: 'edit' as const, editedText: '이전 리뷰의 수정' } },
    }

    const state = appReducer(stale, { type: 'ISSUES_LOADED', issues: [{ id: 'a' }, { id: 'b' }] as IssueResponse[] })

    expect(state.currentIssueIndex).toBe(0)
    expect(state.editingIssueId).toBeNull()
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
    })
  })

  it('CONFLUENCE_DETECTED sets title, markdown, and status', () => {
    const state = appReducer(initialAppState, {
      type: 'CONFLUENCE_DETECTED',
      title: '기획서',
      markdown: '# 기획서',
    })

    expect(state.confluenceStatus).toBe('detected')
    expect(state.confluencePageTitle).toBe('기획서')
    expect(state.confluenceMarkdown).toBe('# 기획서')
  })

  it('CONFLUENCE_NOT_A_PAGE clears title/markdown', () => {
    const detected = appReducer(initialAppState, {
      type: 'CONFLUENCE_DETECTED',
      title: '기획서',
      markdown: '# 기획서',
    })

    const state = appReducer(detected, { type: 'CONFLUENCE_NOT_A_PAGE' })

    expect(state.confluenceStatus).toBe('not_confluence')
    expect(state.confluencePageTitle).toBeNull()
    expect(state.confluenceMarkdown).toBeNull()
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

  it('NAVIGATE_ISSUE does not go below index 0', () => {
    const withIssues = { ...initialAppState, issues: [{}, {}] as IssueResponse[], currentIssueIndex: 0 }

    const state = appReducer(withIssues, { type: 'NAVIGATE_ISSUE', direction: 'prev' })

    expect(state.currentIssueIndex).toBe(0)
  })

  it('NAVIGATE_ISSUE does not go past the last issue', () => {
    const withIssues = { ...initialAppState, issues: [{}, {}] as IssueResponse[], currentIssueIndex: 1 }

    const state = appReducer(withIssues, { type: 'NAVIGATE_ISSUE', direction: 'next' })

    expect(state.currentIssueIndex).toBe(1)
  })

  it('SELECT_ISSUE_BY_ID jumps to the matching issue', () => {
    const withIssues = {
      ...initialAppState,
      issues: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] as IssueResponse[],
      currentIssueIndex: 0,
    }

    const state = appReducer(withIssues, { type: 'SELECT_ISSUE_BY_ID', issueId: 'c' })

    expect(state.currentIssueIndex).toBe(2)
  })

  it('SELECT_ISSUE_BY_ID is a no-op for an unknown id', () => {
    const withIssues = {
      ...initialAppState,
      issues: [{ id: 'a' }, { id: 'b' }] as IssueResponse[],
      currentIssueIndex: 1,
    }

    const state = appReducer(withIssues, { type: 'SELECT_ISSUE_BY_ID', issueId: 'does-not-exist' })

    expect(state.currentIssueIndex).toBe(1)
  })

  it('START_EDIT_ISSUE and STOP_EDIT_ISSUE toggle editingIssueId', () => {
    const editing = appReducer(initialAppState, { type: 'START_EDIT_ISSUE', issueId: 'a' })
    expect(editing.editingIssueId).toBe('a')

    const stopped = appReducer(editing, { type: 'STOP_EDIT_ISSUE' })
    expect(stopped.editingIssueId).toBeNull()
  })

  it('NAVIGATE_ISSUE and SELECT_ISSUE_BY_ID clear an in-progress edit', () => {
    const withIssues = {
      ...initialAppState,
      issues: [{ id: 'a' }, { id: 'b' }] as IssueResponse[],
      currentIssueIndex: 0,
      editingIssueId: 'a',
    }

    const afterNav = appReducer(withIssues, { type: 'NAVIGATE_ISSUE', direction: 'next' })
    expect(afterNav.editingIssueId).toBeNull()

    const afterSelect = appReducer({ ...withIssues, editingIssueId: 'a' }, { type: 'SELECT_ISSUE_BY_ID', issueId: 'b' })
    expect(afterSelect.editingIssueId).toBeNull()
  })

  it('RULE_CATEGORIES_LOADED stores the categories', () => {
    const state = appReducer(initialAppState, {
      type: 'RULE_CATEGORIES_LOADED',
      categories: [{ category: 'LG', label: '논리비약' }],
    })

    expect(state.ruleCategories).toEqual([{ category: 'LG', label: '논리비약' }])
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
