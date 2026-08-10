import { Fragment } from 'react'
import { splitQuotedSegments } from '../../utils/quoteSegments'

// AI 제안/검증이유 문장 전체를 다 강조하면 오히려 핵심이 안 보여서, 따옴표로 감싼 구간(구체적
// 대안·인용구)만 골라 강조한다 — content script의 AI 제안 말풍선과 같은 분리 로직(utils/
// quoteSegments.ts)을 쓰되, 여기서는 HTML 문자열 대신 React 엘리먼트로 렌더링한다.
export function QuoteHighlightedText({ text, quoteClassName }: { text: string; quoteClassName: string }) {
  return (
    <>
      {splitQuotedSegments(text).map((segment, index) =>
        segment.quoted ? (
          <span key={index} className={quoteClassName}>
            {segment.text}
          </span>
        ) : (
          <Fragment key={index}>{segment.text}</Fragment>
        ),
      )}
    </>
  )
}
