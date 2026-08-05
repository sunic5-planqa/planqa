import { describe, expect, it } from 'vitest'
import type { IssueResponse } from '../api/types'
import { groupIssuesByCriteria } from './issueGrouping'

function makeIssue(overrides: Partial<IssueResponse>): IssueResponse {
  return {
    id: 'id',
    location: 'loc',
    input_text: 'input',
    criteria: 'criteria',
    reason: 'reason',
    suggestion: 'suggestion',
    ...overrides,
  }
}

describe('groupIssuesByCriteria', () => {
  it('groups issues that share the same criteria', () => {
    const issues = [
      makeIssue({ id: '1', criteria: '용어 및 단어의 일관성' }),
      makeIssue({ id: '2', criteria: '정보 누락' }),
      makeIssue({ id: '3', criteria: '용어 및 단어의 일관성' }),
    ]

    const groups = groupIssuesByCriteria(issues)

    expect(groups).toEqual([
      { criteria: '용어 및 단어의 일관성', issues: [issues[0], issues[2]] },
      { criteria: '정보 누락', issues: [issues[1]] },
    ])
  })

  it('returns an empty list for no issues', () => {
    expect(groupIssuesByCriteria([])).toEqual([])
  })

  it('preserves the order criteria first appear in', () => {
    const issues = [makeIssue({ id: '1', criteria: 'B' }), makeIssue({ id: '2', criteria: 'A' })]

    expect(groupIssuesByCriteria(issues).map((g) => g.criteria)).toEqual(['B', 'A'])
  })
})
