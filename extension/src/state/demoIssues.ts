import type { FrameType, IssueResponse, ParsedStructure } from '../api/types'

// QA 엔진이 없는 동안, 지금 열려있는 실제 문서(모의 문서 포함) 안의 실제 문장을 그대로 골라 가짜 이슈를
// 만든다. input_text가 원문과 정확히 같아야 인라인 오버레이(useIssueOverlaySync)가 어떤 컨플루언스
// 페이지에서도 하이라이트를 찾아낼 수 있다 — 고정 문구를 쓰던 이전 FIXTURE_ISSUES는 그 목적상
// 특정 mock 문서에서만 동작했다.
const MIN_SENTENCE_LENGTH = 8

interface DemoTemplate {
  criteria: string
  reason: string
  suggest: (sentence: string) => string
  frameType: FrameType
}

const DEMO_TEMPLATES: DemoTemplate[] = [
  {
    criteria: '모호한 표현',
    reason: '표현이 다소 모호해 다른 팀원이 다르게 해석할 수 있습니다. (QA 엔진 미구현 — 데모용 예시)',
    suggest: (s) => `${s} (구체적인 기준 명시 필요)`,
    frameType: 'object',
  },
  {
    criteria: '정보 누락',
    reason: '이 내용을 뒷받침할 구체적인 근거나 수치가 없습니다. (QA 엔진 미구현 — 데모용 예시)',
    suggest: (s) => `${s} (근거 데이터 추가 필요)`,
    frameType: 'insert_range',
  },
  {
    criteria: '용어 및 단어의 일관성',
    reason: '문서 내 다른 곳에서 같은 대상을 다른 용어로 표현했을 가능성이 있습니다. (QA 엔진 미구현 — 데모용 예시)',
    suggest: (s) => `${s} (용어 통일 필요)`,
    frameType: 'object',
  },
]

interface FlatSentence {
  chapterTitle: string
  text: string
}

function flattenSentences(structure: ParsedStructure): FlatSentence[] {
  const out: FlatSentence[] = []
  for (const chapter of structure.chapters) {
    for (const paragraph of chapter.paragraphs) {
      for (const sentence of paragraph.sentences) {
        const text = sentence.text.trim()
        if (text.length >= MIN_SENTENCE_LENGTH) out.push({ chapterTitle: chapter.title, text })
      }
    }
  }
  return out
}

export function buildDemoIssues(structure: ParsedStructure, count = 3): IssueResponse[] {
  const sentences = flattenSentences(structure)
  if (sentences.length === 0) return []

  const step = Math.max(1, Math.floor(sentences.length / count))
  const picks: FlatSentence[] = []
  for (let i = 0; i < count && i * step < sentences.length; i++) {
    picks.push(sentences[i * step])
  }

  return picks.map((pick, idx) => {
    const template = DEMO_TEMPLATES[idx % DEMO_TEMPLATES.length]
    return {
      id: `demo-${idx + 1}`,
      location: pick.chapterTitle,
      location_number: null,
      input_text: pick.text,
      criteria: template.criteria,
      reason: template.reason,
      suggestion: template.suggest(pick.text),
      frame_type: template.frameType,
      related_location: null,
      related_original_text: null,
    }
  })
}
