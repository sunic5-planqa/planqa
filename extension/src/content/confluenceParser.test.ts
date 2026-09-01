import { describe, expect, it } from 'vitest'
import { htmlToChapterMarkdown } from './confluenceParser'

describe('htmlToChapterMarkdown', () => {
  it('converts a single heading and paragraph', () => {
    const html = '<h2>배경</h2><p>기존 도구는 QA를 수동으로 합니다.</p>'

    const result = htmlToChapterMarkdown('기획서 제목', html)

    expect(result).toBe('# 기획서 제목\n\n## 배경\n\n기존 도구는 QA를 수동으로 합니다.')
  })

  it('preserves relative heading depth instead of flattening everything to ##', () => {
    // QA 엔진(document.py)이 ##=논리 단위, ###+=그 안의 문단으로 나누기 때문에, 깊이를 뭉개면
    // 원래 한 논리 단위 안에 있어야 할 소제목이 별도 논리 단위로 갈라져 검토 대상이 부풀려진다.
    const html = '<h1>큰제목</h1><p>내용1</p><h3>작은제목</h3><p>내용2</p>'

    const result = htmlToChapterMarkdown('제목', html)

    expect(result).toBe('# 제목\n\n## 큰제목\n\n내용1\n\n### 작은제목\n\n내용2')
  })

  it('preserveHeadingLevels: keeps a body h1 at level 1 instead of flattening it to h2', () => {
    // 실사용 중 확인된 버그: 넘버링 검증은 "구조는 heading level로만 판단한다"는 원칙인데, 대주제를
    // Heading 1로, 소주제를 Heading 2로 쓴 실제 문서에서 기본 동작(h1을 h2로 클램프)을 그대로 쓰면
    // 대주제/소주제가 전부 같은 레벨(##)로 뭉개져 하나의 형제 그룹으로 섞여버린다 — 넘버링 재조회
    // 전용으로 h1~h6 원래 레벨을 보존하는 옵션이 필요하다.
    const html = '<h1>1. 대주제</h1><h2>1-1. 소주제</h2><h1>2. 대주제</h1><h2>2-1. 소주제</h2>'

    const result = htmlToChapterMarkdown('제목', html, { preserveHeadingLevels: true })

    expect(result).toBe('# 제목\n\n# 1. 대주제\n\n## 1-1. 소주제\n\n# 2. 대주제\n\n## 2-1. 소주제')
  })

  it('preserveHeadingLevels omitted or false keeps the existing AI-QA clamped behavior unchanged', () => {
    const html = '<h1>1. 대주제</h1><h2>1-1. 소주제</h2>'

    expect(htmlToChapterMarkdown('제목', html)).toBe('# 제목\n\n## 1. 대주제\n\n## 1-1. 소주제')
    expect(htmlToChapterMarkdown('제목', html, { preserveHeadingLevels: false })).toBe(
      '# 제목\n\n## 1. 대주제\n\n## 1-1. 소주제',
    )
  })

  it('caps heading depth at h6 (######) even for deeper markup', () => {
    const html = '<h2>제목</h2><h6>더깊은제목</h6><p>내용</p>'

    const result = htmlToChapterMarkdown('문서', html)

    expect(result).toContain('###### 더깊은제목')
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

  it('renders each list item as its own markdown bullet line', () => {
    // 쉼표로 한 줄에 이어붙이면 실제 문서엔 없는 문구가 만들어지고(저장 단계에서 원문을 못 찾는
    // 원인이 됐었다), review-agent의 document.py도 "- "로 시작하는 줄을 불릿 하나로 인식한다.
    const html = '<ul><li>항목 하나</li><li>항목 둘</li></ul>'

    const result = htmlToChapterMarkdown('제목', html)

    expect(result).toBe('# 제목\n\n- 항목 하나\n- 항목 둘')
  })

  it('flattens a nested list without merging or duplicating the sub-items', () => {
    // 실사용 중 확인된 버그(NxEF 쿠폰/프로모션 PRD, "3. 성공 지표") — <li> 안에 <ul>이 중첩되면
    // querySelectorAll('li')가 하위 li까지 한 번에 다 가져와서: (1) 상위 li.textContent가 자기
    // 텍스트+하위 목록 텍스트를 구분자 없이 뭉개고, (2) 그 하위 항목들이 별도 줄로 또 한 번
    // 나와서 실제 문서엔 없는 진짜 중복을 만들어냈다. QA 엔진이 그 가짜 중복을 "불필요한 중복
    // (RD)"으로 정확히 잡아내도, 절반은 라이브 문서에 없는 텍스트라 저장 단계에서 못 찾았다.
    const html =
      '<ul><li><p>쿠폰 적용 주문의 구매 전환율이 미적용 주문 대비 1.3배 이상</p>' +
      '<ul><li><p>측정 기간: 쿠폰 캠페인 시작일로부터 30일</p></li>' +
      '<li><p>산정 방법: 쿠폰 적용 고객 중 구매 완료 고객 비율을 비교</p></li></ul></li>' +
      '<li><p>발급된 쿠폰의 실제 사용율 30% 이상</p></li></ul>'

    const result = htmlToChapterMarkdown('제목', html)

    expect(result).toBe(
      '# 제목\n\n' +
        '- 쿠폰 적용 주문의 구매 전환율이 미적용 주문 대비 1.3배 이상\n' +
        '- 측정 기간: 쿠폰 캠페인 시작일로부터 30일\n' +
        '- 산정 방법: 쿠폰 적용 고객 중 구매 완료 고객 비율을 비교\n' +
        '- 발급된 쿠폰의 실제 사용율 30% 이상',
    )
  })

  it('renders table rows as markdown table lines instead of concatenating every cell', () => {
    // 분기가 없으면 표 전체 textContent가 셀 구분자 하나 없이 그냥 붙어버려서(목록의 ", "
    // 이어붙이기보다 더 심함) 실제 문서엔 없는 문구가 만들어졌었다.
    const html =
      '<table><thead><tr><th><p>서비스</p></th><th><p>참고</p></th></tr></thead>' +
      '<tbody><tr><td><p>크림</p></td><td><p>희소성</p></td></tr></tbody></table>'

    const result = htmlToChapterMarkdown('제목', html)

    expect(result).toBe('# 제목\n\n| 서비스 | 참고 |\n| 크림 | 희소성 |')
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
