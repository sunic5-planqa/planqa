import { describe, expect, it } from 'vitest'
import { formatLocationLabel } from './locationLabel'

describe('formatLocationLabel', () => {
  it('returns the raw location unchanged when there is no computed number', () => {
    expect(formatLocationLabel('배경', null)).toBe('배경')
  })

  it('prepends the computed number when the heading has no number of its own', () => {
    expect(formatLocationLabel('배경', '1')).toBe('1. 배경')
  })

  it('strips the author\'s own leading number to avoid double numbering', () => {
    expect(formatLocationLabel('1. 배경', '1')).toBe('1. 배경')
  })

  it('strips a multi-segment leading number (e.g. "2-1.")', () => {
    expect(formatLocationLabel('2-1. 세부 요구사항', '2-1')).toBe('2-1. 세부 요구사항')
  })

  it('strips a leading number even without a trailing period', () => {
    expect(formatLocationLabel('3 결제 정책', '3')).toBe('3. 결제 정책')
  })

  it('does not touch numbers that are not at the very start of the label', () => {
    expect(formatLocationLabel('2024년 정책', '4')).toBe('4. 2024년 정책')
  })

  it('shows only the innermost segment of a " > " chain, with the computed number', () => {
    expect(formatLocationLabel('발송 정책 > 발송 채널', '3-2')).toBe('3-2. 발송 채널')
  })

  it('shows only the innermost segment of a chain even without a computed number', () => {
    expect(formatLocationLabel('대상 관리 > 대상 제외 기준', null)).toBe('대상 제외 기준')
  })

  it('strips the author\'s own number on the leaf segment of a chain', () => {
    expect(formatLocationLabel('2. 발송 정책 > 2-3. 대상 제외 기준', '2-3')).toBe('2-3. 대상 제외 기준')
  })
})
