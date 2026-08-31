import type { IssueResponse } from '../../api/types'
import { useAppDispatch, useAppState } from '../../state/hooks'
import { formatLocationLabel } from '../../utils/locationLabel'

// 관계형 이슈(related_original_text 있음)에서만 ‹ › 순회가 의미 있다 — 없으면 단일 위치만 보여주고
// 버튼은 비활성화한다. activeLocationIndex(전역 상태)를 그대로 반영하므로, 여기서 순회하면
// SuggestionDirectionCard가 편집하는 대상과 문서 쪽 틴트도 함께 따라 바뀐다.
export function LocationNavigator({ issue }: { issue: IssueResponse }) {
  const { activeLocationIndex } = useAppState()
  const dispatch = useAppDispatch()

  const hasRelated = !!issue.related_original_text
  const locations = hasRelated
    ? [formatLocationLabel(issue.location, issue.location_number), issue.related_location ?? '관련 위치']
    : [formatLocationLabel(issue.location, issue.location_number)]

  const total = locations.length
  const index = hasRelated ? activeLocationIndex : 0
  const nextLabel = locations[(index + 1) % total]

  return (
    <div className="location-navigator">
      <div className="location-navigator-row">
        <button
          type="button"
          className="location-navigator-btn location-navigator-btn-prev"
          disabled={!hasRelated}
          onClick={() => dispatch({ type: 'CYCLE_ACTIVE_LOCATION' })}
        >
          ‹
        </button>
        <div className="location-navigator-center">
          <span className="location-navigator-label">{locations[index]}</span>
          {hasRelated && (
            <span className="location-navigator-counter">
              {index + 1} / {total} · 다음은 {nextLabel}
            </span>
          )}
        </div>
        <button
          type="button"
          className="location-navigator-btn location-navigator-btn-next"
          disabled={!hasRelated}
          onClick={() => dispatch({ type: 'CYCLE_ACTIVE_LOCATION' })}
        >
          ›
        </button>
      </div>
      {hasRelated && (
        <div className="location-navigator-steps">
          {locations.map((_, i) => (
            <span
              key={i}
              className={`location-navigator-step ${i === index ? 'location-navigator-step-active' : ''}`.trim()}
            />
          ))}
        </div>
      )}
    </div>
  )
}
