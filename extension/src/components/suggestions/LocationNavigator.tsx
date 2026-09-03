import type { IssueResponse } from '../../api/types'
import { useAppDispatch, useAppState } from '../../state/hooks'
import { locationLeaf } from '../../utils/locationLabel'

// 관계형 오류(LG/LF/GA, related_original_text 있음)에서만 나온다 — 두 위치를 탭으로 보여줘서
// "지금 문서에서 어느 쪽을 편집 중인지"(activeLocationIndex)를 전환할 수 있게 한다. 단일 위치
// 오류의 위치는 RuleEvidenceCard의 "문서 위치"에서 이미 보여주므로 여기선 아무것도 그리지 않는다.
//
// 탭 텍스트는 백엔드가 계산한 넘버(2, 2-3, 3-5 …)를 쓴다. 넘버를 못 구하는 경우(타문서 정합성
// XDC처럼 "[문서명] 섹션"이거나 LLM 라벨이 계산 키와 안 맞을 때)만 짧은 제목으로 폴백한다.
export function LocationNavigator({ issue }: { issue: IssueResponse }) {
  const { activeLocationIndex } = useAppState()
  const dispatch = useAppDispatch()

  if (!issue.related_original_text) return null

  const tabs = [
    issue.location_number ?? locationLeaf(issue.location),
    issue.related_location_number ?? (issue.related_location ? locationLeaf(issue.related_location) : '관련 위치'),
  ]

  // activeLocationIndex는 0/1 두 값뿐이라 "다른 쪽 탭 클릭 = 토글"과 같다.
  const select = (target: 0 | 1) => {
    if (target !== activeLocationIndex) dispatch({ type: 'CYCLE_ACTIVE_LOCATION' })
  }

  return (
    <div className="location-navigator">
      <div className="location-navigator-tabs" role="tablist">
        {tabs.map((text, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={i === activeLocationIndex}
            className={`location-navigator-tab ${i === activeLocationIndex ? 'location-navigator-tab-active' : ''}`.trim()}
            onClick={() => select(i as 0 | 1)}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  )
}
