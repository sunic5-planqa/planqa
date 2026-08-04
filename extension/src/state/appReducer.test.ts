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

  it('TOGGLE_REFERENCE_FILE adds an id when not selected', () => {
    const state = appReducer(initialAppState, { type: 'TOGGLE_REFERENCE_FILE', fileId: 'f1' })

    expect(state.selectedReferenceFileIds).toEqual(['f1'])
  })

  it('TOGGLE_REFERENCE_FILE removes an id when already selected', () => {
    const withOne = appReducer(initialAppState, { type: 'TOGGLE_REFERENCE_FILE', fileId: 'f1' })
    const withTwo = appReducer(withOne, { type: 'TOGGLE_REFERENCE_FILE', fileId: 'f2' })

    const state = appReducer(withTwo, { type: 'TOGGLE_REFERENCE_FILE', fileId: 'f1' })

    expect(state.selectedReferenceFileIds).toEqual(['f2'])
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
})
