const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6'])

// 컨플루언스 h1~h6를 상대적인 깊이를 보존해서 #(문서제목=페이지 타이틀 한 줄) 아래
// ##(논리 단위)~######(문단 하위구간)로 그대로 옮긴다 — QA 엔진(qa_engine/review_agent/document.py)이
// ##는 논리 단위, ###~######는 그 안의 문단 경계로 나눠서 계층별(문서/논리단위/문단/문장) 검토를
// 하기 때문에, 예전처럼 전부 ##로 뭉개버리면 원래 한 논리 단위 안에 중첩돼야 할 소제목들이 전부
// 별도의 최상위 논리 단위로 갈라져 나가 검토 대상 chunk 수가 실제보다 몇 배로 부풀려진다(실사용
// 중 같은 문서인데 CLI 직접 실행 대비 서버 실행에서 이슈가 훨씬 많이 나온 원인). 본문에 h1이
// 나오는 경우(페이지 타이틀과 별개로)는 h2와 동급(##)으로 취급 — `#`는 페이지 타이틀 전용으로
// 이미 위에서 한 줄 썼기 때문.
export function htmlToChapterMarkdown(pageTitle: string, storageHtml: string): string {
  const doc = new DOMParser().parseFromString(storageHtml, 'text/html')
  const lines: string[] = [`# ${pageTitle}`]

  for (const node of Array.from(doc.body.children)) {
    if (HEADING_TAGS.has(node.tagName)) {
      const text = collapseWhitespace(node.textContent ?? '')
      const level = Math.min(Math.max(Number(node.tagName[1]), 2), 6)
      if (text) lines.push('', `${'#'.repeat(level)} ${text}`)
      continue
    }

    if (node.tagName === 'UL' || node.tagName === 'OL') {
      // 쉼표로 한 줄에 이어붙이면(예전 방식) 실제 문서엔 없는 문구를 만들어내는 셈이라, QA 엔진이
      // 그 가짜 텍스트를 그대로 인용하면 저장 단계에서 원문을 영영 찾을 수 없다(DOC-001 "목표
      // 런칭일:, QA 기간:" 케이스로 실제 확인). review-agent의 document.py도 `- `로 시작하는 줄을
      // 하나의 문장 단위(불릿)로 인식하도록 짜여 있어서, 항목마다 별도 줄의 마크다운 불릿으로 남긴다.
      const items = Array.from(node.querySelectorAll('li'))
        .map((li) => collapseWhitespace(li.textContent ?? ''))
        .filter(Boolean)
      if (items.length) {
        lines.push('')
        for (const item of items) lines.push(`- ${item}`)
      }
      continue
    }

    if (node.tagName === 'TABLE') {
      // 분기가 없으면 아래 fallback으로 떨어져서 표 전체 textContent를 셀 구분자 하나 없이 그냥
      // 이어붙여버린다(목록의 ", " 이어붙이기보다 더 심함 — 그마저도 없음) — 실제 문서엔 없는
      // 문구가 만들어지는 건 똑같다. document.py의 `_TABLE_ROW_LINE`(`|...|`)이 행 하나를 문장
      // 단위로 인식하도록 짜여 있어서, 행마다 마크다운 표 문법으로 별도 줄에 남긴다.
      const rows = Array.from(node.querySelectorAll('tr'))
        .map((tr) => Array.from(tr.querySelectorAll('th, td')).map((cell) => collapseWhitespace(cell.textContent ?? '')))
        .filter((cells) => cells.some(Boolean))
      if (rows.length) {
        lines.push('')
        for (const cells of rows) lines.push(`| ${cells.join(' | ')} |`)
      }
      continue
    }

    const text = collapseWhitespace(node.textContent ?? '')
    if (text) lines.push('', text)
  }

  return lines.join('\n').trim()
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}
