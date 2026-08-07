import { describe, expect, it } from 'vitest'
import type { IssueResponse } from '../api/types'
import { appReducer } from './appReducer'
import { initialAppState } from './types'

describe('appReducer', () => {
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
})
