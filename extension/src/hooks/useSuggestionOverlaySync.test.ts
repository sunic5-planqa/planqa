import { describe, expect, it } from 'vitest'
import type { IssueResponse } from '../api/types'
import { computeOverlayTargets } from './useSuggestionOverlaySync'

function issue(overrides: Partial<IssueResponse> = {}): IssueResponse {
  return {
    id: 'issue-1',
    location: '결제 수단',
    location_number: null,
    input_text: '3사만 지원',
    criteria: '용어 및 단어의 일관성',
    reason: '테스트용 이유',
    suggestion: '4사만 지원',
    frame_type: 'object',
    related_location: null,
    related_location_number: null,
    related_original_text: null,
    ...overrides,
  }
}

describe('computeOverlayTargets', () => {
  it('sends only the primary location as current when the issue has no related location', () => {
    const { current, related } = computeOverlayTargets(issue(), undefined, 0)

    expect(current).toMatchObject({ text: '3사만 지원', location: '결제 수단', suggestion: '4사만 지원' })
    expect(related).toBeNull()
  })

  it('sends the primary as current and the related as a read-only tint when viewing the primary side of a same-document (LG/LF/GA) issue', () => {
    const lgIssue = issue({ related_location: '결제 실패 안내', related_original_text: '안내 문구 없음' })

    const { current, related } = computeOverlayTargets(lgIssue, undefined, 0)

    expect(current).toMatchObject({ text: '3사만 지원', suggestion: '4사만 지원' })
    expect(related).toEqual({ text: '안내 문구 없음', location: '결제 실패 안내' })
  })

  it('swaps current/related when viewing the related side of a same-document (LG/LF/GA) issue', () => {
    const lgIssue = issue({ related_location: '결제 실패 안내', related_original_text: '안내 문구 없음' })

    const { current, related } = computeOverlayTargets(lgIssue, undefined, 1)

    expect(current).toMatchObject({ text: '안내 문구 없음', location: '결제 실패 안내', suggestion: null })
    expect(related).toEqual({ text: '3사만 지원', location: '결제 수단' })
  })

  // 실사용 버그(코드 리뷰로 확인): XDC(타문서 정합성)의 related는 참고문서 쪽 원문이라 지금 문서
  // 안에는 존재하지 않는다 — 내비게이터로 그쪽을 보는 중이어도 current/related를 뒤바꾸면 안
  // 된다. 뒤바꾸면 참고문서 인용구를 문서에서 찾다가(못 찾으면 헤딩-폴백) 우연히 같은 이름의
  // 헤딩이 있을 때 그 엉뚱한 위치가 편집 가능하게 열려버린다.
  it('never swaps to the reference-document side for an XDC issue, even when the navigator points at it', () => {
    const xdcIssue = issue({
      related_location: '[정책 문서] 발송 정책',
      related_original_text: '신청 기한은 14일 이내',
    })

    const viewingPrimary = computeOverlayTargets(xdcIssue, undefined, 0)
    const viewingReference = computeOverlayTargets(xdcIssue, undefined, 1)

    for (const { current, related } of [viewingPrimary, viewingReference]) {
      expect(current).toMatchObject({ text: '3사만 지원', location: '결제 수단', suggestion: '4사만 지원' })
      // 참고문서 원문은 이 문서에서 앵커링을 시도할 대상 자체가 없으므로 related로도 안 보낸다.
      expect(related).toBeNull()
    }
  })

  it('resolves already-saved edited text instead of the original input_text', () => {
    const lgIssue = issue({ related_location: '결제 실패 안내', related_original_text: '안내 문구 없음' })
    const edit = { action: 'edit' as const, editedText: '4사만 지원, 페이코 미지원', relatedEditedText: '재시도 안내' }

    const { current, related } = computeOverlayTargets(lgIssue, edit, 0)

    expect(current).toMatchObject({ text: '4사만 지원, 페이코 미지원' })
    expect(related).toEqual({ text: '재시도 안내', location: '결제 실패 안내' })
  })
})
