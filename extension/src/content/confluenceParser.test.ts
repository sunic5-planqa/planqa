import { describe, expect, it } from 'vitest'
import { htmlToChapterMarkdown } from './confluenceParser'

describe('htmlToChapterMarkdown', () => {
  it('converts a single heading and paragraph', () => {
    const html = '<h2>배경</h2><p>기존 도구는 QA를 수동으로 합니다.</p>'

    const result = htmlToChapterMarkdown('기획서 제목', html)

    expect(result).toBe('# 기획서 제목\n\n## 배경\n\n기존 도구는 QA를 수동으로 합니다.')
  })

  it('flattens all heading levels (h1-h6) to chapter markers', () => {
    const html = '<h1>큰제목</h1><p>내용1</p><h3>작은제목</h3><p>내용2</p>'

    const result = htmlToChapterMarkdown('제목', html)

    expect(result).toBe('# 제목\n\n## 큰제목\n\n내용1\n\n## 작은제목\n\n내용2')
  })

  it('returns only the title when the body is empty', () => {
    const result = htmlToChapterMarkdown('빈 문서', '')

    expect(result).toBe('# 빈 문서')
  })

  it('separates consecutive paragraphs with a blank line', () => {
    const html = '<p>첫번째 문단.</p><p>두번째 문단.</p>'

    const result = htmlToChapterMarkdown('제목', html)

    expect(result).toBe('# 제목\n\n첫번째 문단.\n\n두번째 문단.')
  })

  it('joins list items into a single line', () => {
    const html = '<ul><li>항목 하나</li><li>항목 둘</li></ul>'

    const result = htmlToChapterMarkdown('제목', html)

    expect(result).toBe('# 제목\n\n항목 하나, 항목 둘')
  })

  it('best-effort extracts text content from unrecognized elements like macros', () => {
    const html = '<ac:structured-macro><ac:parameter>info</ac:parameter>매크로 안 텍스트</ac:structured-macro>'

    const result = htmlToChapterMarkdown('제목', html)

    expect(result).toContain('매크로 안 텍스트')
  })

  it('collapses internal whitespace and skips empty elements', () => {
    const html = '<p>  여러   공백   포함  </p><p>   </p>'

    const result = htmlToChapterMarkdown('제목', html)

    expect(result).toBe('# 제목\n\n여러 공백 포함')
  })
})
