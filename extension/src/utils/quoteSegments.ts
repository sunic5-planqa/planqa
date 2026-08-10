export interface TextSegment {
  text: string
  quoted: boolean
}

// 작은따옴표/큰따옴표로 감싼 구간(구체적 대안·인용구, 예: '핵클 SDK 연동'으로 수정)과 나머지 구간을
// 나눠서 반환한다 — AI 제안/검증이유 문장 전체를 다 강조하면 오히려 핵심이 안 보여서, 이 구간만
// 그라데이션 등으로 강조하기 위한 공용 분리 로직. content script(issueOverlay.ts, HTML 문자열
// 조립)와 사이드패널(React 엘리먼트 렌더링) 양쪽에서 같은 정규식을 쓰지만 렌더링 방식이 서로 달라
// 여기서는 순수 분리 로직만 공유한다.
const QUOTED_SPAN_RE = /(['"])((?:(?!\1).)+)\1/g

export function splitQuotedSegments(text: string): TextSegment[] {
  const segments: TextSegment[] = []
  let lastIndex = 0
  for (const match of text.matchAll(QUOTED_SPAN_RE)) {
    const start = match.index ?? 0
    if (start > lastIndex) segments.push({ text: text.slice(lastIndex, start), quoted: false })
    segments.push({ text: match[0], quoted: true })
    lastIndex = start + match[0].length
  }
  if (lastIndex < text.length) segments.push({ text: text.slice(lastIndex), quoted: false })
  return segments
}
