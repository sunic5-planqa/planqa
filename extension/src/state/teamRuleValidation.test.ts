import { describe, expect, it } from 'vitest'
import { isTeamRuleInputValid } from './teamRuleValidation'

describe('isTeamRuleInputValid', () => {
  it('is valid when both rule_name and description have content', () => {
    expect(isTeamRuleInputValid({ rule_name: '정책 정합성', description: '정책 정합성 검토' })).toBe(true)
  })

  it('is invalid when rule_name is empty', () => {
    expect(isTeamRuleInputValid({ rule_name: '', description: '정책 정합성 검토' })).toBe(false)
  })

  it('is invalid when description is empty', () => {
    expect(isTeamRuleInputValid({ rule_name: '정책 정합성', description: '' })).toBe(false)
  })

  it('is invalid when both are only whitespace', () => {
    expect(isTeamRuleInputValid({ rule_name: '   ', description: '   ' })).toBe(false)
  })
})
