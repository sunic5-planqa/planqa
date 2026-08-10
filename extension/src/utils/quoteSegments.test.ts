import { describe, expect, it } from 'vitest'
import { splitQuotedSegments } from './quoteSegments'

describe('splitQuotedSegments', () => {
  it('returns the whole text as one unquoted segment when there are no quotes', () => {
    expect(splitQuotedSegments('그냥 평범한 문장입니다.')).toEqual([{ text: '그냥 평범한 문장입니다.', quoted: false }])
  })

  it('splits a single quoted span out from the surrounding text', () => {
    const result = splitQuotedSegments("마일스톤의 P2 항목을 '핵클 SDK 연동'으로 수정")
    expect(result).toEqual([
      { text: '마일스톤의 P2 항목을 ', quoted: false },
      { text: "'핵클 SDK 연동'", quoted: true },
      { text: '으로 수정', quoted: false },
    ])
  })

  it('supports double quotes the same way as single quotes', () => {
    const result = splitQuotedSegments('문구를 "정확한 날짜"로 명시')
    expect(result).toEqual([
      { text: '문구를 ', quoted: false },
      { text: '"정확한 날짜"', quoted: true },
      { text: '로 명시', quoted: false },
    ])
  })

  it('handles multiple quoted spans in the same text', () => {
    const result = splitQuotedSegments("'A'를 'B'로 바꾸는 것을 제안")
    expect(result.filter((s) => s.quoted).map((s) => s.text)).toEqual(["'A'", "'B'"])
  })

  it('returns an empty array for an empty string', () => {
    expect(splitQuotedSegments('')).toEqual([])
  })

  it('treats a quote that never closes as plain unquoted text', () => {
    expect(splitQuotedSegments("따옴표가 안 닫힌 문장 '이런 식으로")).toEqual([
      { text: "따옴표가 안 닫힌 문장 '이런 식으로", quoted: false },
    ])
  })
})
