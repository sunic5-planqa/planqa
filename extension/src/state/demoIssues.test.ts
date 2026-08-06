import { describe, expect, it } from 'vitest'
import type { ParsedStructure } from '../api/types'
import { buildDemoIssues } from './demoIssues'

function makeStructure(sentenceTexts: string[]): ParsedStructure {
  return {
    title: '테스트 문서',
    chapters: [
      {
        id: 'ch1',
        title: '1장 개요',
        start: 0,
        end: 0,
        paragraphs: [
          {
            id: 'p1',
            start: 0,
            end: 0,
            sentences: sentenceTexts.map((text, idx) => ({ id: `s${idx}`, text, start: 0, end: 0 })),
          },
        ],
      },
    ],
  }
}

describe('buildDemoIssues', () => {
  it('returns an empty list for a document with no sentences', () => {
    expect(buildDemoIssues(makeStructure([]))).toEqual([])
  })

  it('picks input_text that exactly matches sentences from the document', () => {
    const structure = makeStructure([
      '결제 실패율이 4.2%로 전 분기 대비 상승하였다.',
      '간편결제 지원 수단을 4종에서 7종으로 확대한다.',
      '기획 확정은 8월 3주차를 목표로 진행한다.',
    ])

    const issues = buildDemoIssues(structure, 3)

    expect(issues).toHaveLength(3)
    for (const issue of issues) {
      expect(structure.chapters[0].paragraphs[0].sentences.map((s) => s.text)).toContain(issue.input_text)
    }
  })

  it('skips sentences shorter than the minimum length', () => {
    const structure = makeStructure(['짧다', '이 문장은 충분히 길어서 데모 이슈로 뽑힐 수 있습니다.'])

    const issues = buildDemoIssues(structure, 3)

    expect(issues.every((issue) => issue.input_text !== '짧다')).toBe(true)
  })

  it('never produces more issues than requested', () => {
    const structure = makeStructure(['첫 번째로 충분히 긴 문장입니다.', '두 번째로 충분히 긴 문장입니다.'])

    expect(buildDemoIssues(structure, 3).length).toBeLessThanOrEqual(3)
  })

  it('tags each issue with its source chapter title as location', () => {
    const structure = makeStructure(['이 문서 안의 실제 문장을 그대로 데모 이슈로 사용합니다.'])

    const issues = buildDemoIssues(structure, 1)

    expect(issues[0].location).toBe('1장 개요')
  })
})
