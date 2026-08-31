import { describe, expect, it } from 'vitest'
import type { IssueResponse } from '../api/types'
import type { IssueEdit } from './types'
import { deriveProgress, getNextOpenIssueId, getOpenIssues } from './suggestionProgress'

const ISSUES = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }] as IssueResponse[]

describe('deriveProgress', () => {
  it('counts apply/edit as done and skip as skipped, leaving the rest open', () => {
    const edits: Record<string, IssueEdit> = {
      a: { action: 'apply' },
      b: { action: 'edit', editedText: '수정본' },
      c: { action: 'skip' },
    }

    expect(deriveProgress(ISSUES, edits)).toEqual({ done: 2, skipped: 1, total: 4 })
  })

  it('reports all-zero progress when nothing has been staged yet', () => {
    expect(deriveProgress(ISSUES, {})).toEqual({ done: 0, skipped: 0, total: 4 })
  })
})

describe('getOpenIssues', () => {
  it('returns only issues with no issueEdits entry, in original order', () => {
    const edits: Record<string, IssueEdit> = { a: { action: 'apply' }, c: { action: 'skip' } }

    expect(getOpenIssues(ISSUES, edits).map((i) => i.id)).toEqual(['b', 'd'])
  })

  it('returns every issue when nothing has been resolved', () => {
    expect(getOpenIssues(ISSUES, {}).map((i) => i.id)).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('getNextOpenIssueId', () => {
  it('returns the next open issue after afterId, in position order', () => {
    const edits: Record<string, IssueEdit> = { a: { action: 'apply' } }

    expect(getNextOpenIssueId(ISSUES, edits, 'a')).toBe('b')
  })

  it('wraps around to an earlier open issue if none remain after afterId', () => {
    const edits: Record<string, IssueEdit> = { a: { action: 'edit' }, c: { action: 'apply' }, d: { action: 'apply' } }

    // b는 afterId(d) 앞에 있지만 여전히 열려있는 유일한 이슈다.
    expect(getNextOpenIssueId(ISSUES, edits, 'd')).toBe('b')
  })

  it('returns null once every issue is resolved', () => {
    const edits: Record<string, IssueEdit> = {
      a: { action: 'apply' },
      b: { action: 'apply' },
      c: { action: 'skip' },
      d: { action: 'skip' },
    }

    expect(getNextOpenIssueId(ISSUES, edits, 'c')).toBeNull()
  })
})
