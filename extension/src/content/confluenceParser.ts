const HEADING_TAGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6'])

// 컨플루언스는 h1~h6로 다단계 헤딩을 쓰지만 백엔드 파서는 #(문서제목)/##(챕터) 2단계만 이해해서
// 본문 안의 모든 헤딩 레벨을 챕터(##)로 평탄화한다. 매크로/표는 best-effort로 textContent만 뽑는다.
export function htmlToChapterMarkdown(pageTitle: string, storageHtml: string): string {
  const doc = new DOMParser().parseFromString(storageHtml, 'text/html')
  const lines: string[] = [`# ${pageTitle}`]

  for (const node of Array.from(doc.body.children)) {
    if (HEADING_TAGS.has(node.tagName)) {
      const text = collapseWhitespace(node.textContent ?? '')
      if (text) lines.push('', `## ${text}`)
      continue
    }

    if (node.tagName === 'UL' || node.tagName === 'OL') {
      const items = Array.from(node.querySelectorAll('li'))
        .map((li) => collapseWhitespace(li.textContent ?? ''))
        .filter(Boolean)
      if (items.length) lines.push('', items.join(', '))
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
