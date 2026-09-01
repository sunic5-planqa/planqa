const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6'])

export interface HtmlToChapterMarkdownOptions {
  // 기본값(false)은 아래 설명대로 본문 h1을 h2와 같은 레벨로 뭉갠다 — AI QA 리뷰용 추출은 이 동작을
  // 그대로 써야 한다. true면 h1~h6 원래 레벨을 그대로 보존한다 — 넘버링 검증(numbering_validation.py)
  // 전용. 이 모듈은 "구조는 Markdown heading level로만 판단한다"는 원칙이라 원본 레벨이 그대로
  // 필요한데, 컨플루언스에서 대주제를 Heading 1로, 소주제를 Heading 2로 쓴 실제 문서가 아래 클램프를
  // 그대로 타면 대주제/소주제가 전부 ##로 뭉개져서 한 형제 그룹으로 섞여버린다(실사용 중 확인된
  // 버그 — 정상 문서에서 번호 중복이 대량으로 오탐됨).
  preserveHeadingLevels?: boolean
}

// 컨플루언스 h1~h6를 상대적인 깊이를 보존해서 #(문서제목=페이지 타이틀 한 줄) 아래
// ##(논리 단위)~######(문단 하위구간)로 그대로 옮긴다 — QA 엔진(qa_engine/review_agent/document.py)이
// ##는 논리 단위, ###~######는 그 안의 문단 경계로 나눠서 계층별(문서/논리단위/문단/문장) 검토를
// 하기 때문에, 예전처럼 전부 ##로 뭉개버리면 원래 한 논리 단위 안에 중첩돼야 할 소제목들이 전부
// 별도의 최상위 논리 단위로 갈라져 나가 검토 대상 chunk 수가 실제보다 몇 배로 부풀려진다(실사용
// 중 같은 문서인데 CLI 직접 실행 대비 서버 실행에서 이슈가 훨씬 많이 나온 원인). 본문에 h1이
// 나오는 경우(페이지 타이틀과 별개로)는 h2와 동급(##)으로 취급 — `#`는 페이지 타이틀 전용으로
// 이미 위에서 한 줄 썼기 때문. (AI QA 리뷰와 무관한 넘버링 검증만은 options.preserveHeadingLevels로
// 이 클램프를 건너뛸 수 있다 — 위 HtmlToChapterMarkdownOptions 설명 참고.)
export function htmlToChapterMarkdown(
  pageTitle: string,
  storageHtml: string,
  options?: HtmlToChapterMarkdownOptions,
): string {
  const doc = new DOMParser().parseFromString(storageHtml, 'text/html')
  const lines: string[] = [`# ${pageTitle}`]

  for (const node of Array.from(doc.body.children)) {
    if (HEADING_TAGS.has(node.tagName)) {
      const text = collapseWhitespace(node.textContent ?? '')
      const level = options?.preserveHeadingLevels
        ? Math.min(Number(node.tagName[1]), 6)
        : Math.min(Math.max(Number(node.tagName[1]), 2), 6)
      if (text) lines.push('', `${'#'.repeat(level)} ${text}`)
      continue
    }

    if (node.tagName === 'UL' || node.tagName === 'OL') {
      // 쉼표로 한 줄에 이어붙이면(예전 방식) 실제 문서엔 없는 문구를 만들어내는 셈이라, QA 엔진이
      // 그 가짜 텍스트를 그대로 인용하면 저장 단계에서 원문을 영영 찾을 수 없다(DOC-001 "목표
      // 런칭일:, QA 기간:" 케이스로 실제 확인). review-agent의 document.py도 `- `로 시작하는 줄을
      // 하나의 문장 단위(불릿)로 인식하도록 짜여 있어서, 항목마다 별도 줄의 마크다운 불릿으로 남긴다.
      const items = flattenListItems(node)
      if (items.length) {
        lines.push('', ...items)
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

// <li> 안에 <ul>/<ol>이 중첩된 경우(하위 불릿), listNode.querySelectorAll('li')로 한 번에 다
// 가져오면 두 가지 문제가 생긴다: (1) 상위 li.textContent가 자기 텍스트와 하위 목록 텍스트를
// 구분자 없이 그대로 이어붙여 뭉갠 문장을 만들고, (2) 그 하위 li들이 querySelectorAll에도 또
// 걸려서 같은 내용이 별도 줄로 한 번 더 나온다 — 실제 문서엔 없는 중복을 우리가 만들어내는
// 셈이라, QA 엔진이 그걸 진짜 "불필요한 중복(RD)"으로 정확히 잡아내도, 그 중복된 절반은 실제
// 라이브 문서에 없는 텍스트라 저장 단계에서 원문을 못 찾는다(실사용 중 확인됨). 직계 자식만
// 순회하고, 각 li 자신의 텍스트는 중첩 목록을 뺀 것만 쓰고, 중첩 목록은 재귀적으로 그 뒤에
// 이어서 별도 줄에 남긴다(한 번만).
function flattenListItems(listNode: Element): string[] {
  const lines: string[] = []
  for (const li of Array.from(listNode.querySelectorAll(':scope > li'))) {
    const nestedLists = Array.from(li.querySelectorAll(':scope > ul, :scope > ol'))
    const clone = li.cloneNode(true) as Element
    for (const nested of Array.from(clone.querySelectorAll('ul, ol'))) nested.remove()
    const ownText = collapseWhitespace(clone.textContent ?? '')
    if (ownText) lines.push(`- ${ownText}`)
    for (const nested of nestedLists) lines.push(...flattenListItems(nested))
  }
  return lines
}
