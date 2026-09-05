import type { IssueResponse } from '../../api/types'
import type { OpenReferenceDocumentRequest, OpenReferenceDocumentResponse } from '../../content/messages'
import { useAppState } from '../../state/hooks'
import { getRuleDescription, getRuleException, getRuleName, getRuleSource } from '../../state/ruleSourceDefaults'
import { formatLocationLabel } from '../../utils/locationLabel'
import { findReferenceDocumentId } from '../../utils/referenceDocumentLink'
import { SourceBadge } from './SourceBadge'

// 팀 규칙일 때 표시할 팀 이름 — 실제로는 팀 규칙 출처 자체가 아직 없어서(getRuleSource는 항상
// 'builtin') 지금은 렌더링될 일이 없다. 백엔드가 팀 규칙 데이터를 내려주기 시작하면 이 자리에
// 실제 팀 이름 필드를 연결해야 한다.
const TEAM_LABEL_PLACEHOLDER = '서비스기획 2팀'

export function RuleEvidenceCard({ issue }: { issue: IssueResponse }) {
  const source = getRuleSource(issue)
  const exception = getRuleException(issue)
  const { referenceFiles, confluenceTabId } = useAppState()
  // 관계형(LG/LF/GA, 같은 문서 안) 이슈는 애초에 다른 페이지가 아니니 null — 그때는 그냥 텍스트로만.
  const referenceDocumentId = issue.related_location
    ? findReferenceDocumentId(issue.related_location, referenceFiles)
    : null

  const openReferenceDocument = () => {
    if (referenceDocumentId === null || confluenceTabId === null) return
    void chrome.tabs
      .sendMessage<OpenReferenceDocumentRequest, OpenReferenceDocumentResponse>(confluenceTabId, {
        type: 'OPEN_REFERENCE_DOCUMENT',
        pageId: referenceDocumentId,
      })
      .catch(() => {})
  }

  return (
    <div className="rule-evidence-card">
      <div className="rule-evidence-header">
        <SourceBadge source={source} />
        <span className="rule-evidence-rule-name">{getRuleName(issue)}</span>
        {source === 'team' && <span className="rule-evidence-team-badge">{TEAM_LABEL_PLACEHOLDER}</span>}
      </div>
      {/* "어떤 규칙에 걸렸는가"(위)와 "문서의 어디에서 났는가"(여기)를 구분해서 보여준다 —
          위치는 QA 결과의 issue.location / issue.location_number 그대로. */}
      <div className="rule-evidence-location">
        <span className="rule-evidence-label">문서 위치</span>
        <span className="rule-evidence-location-value">
          {formatLocationLabel(issue.location, issue.location_number)}
          {issue.related_location && (
            <>
              {' ↔ '}
              {referenceDocumentId !== null ? (
                <button type="button" className="rule-evidence-reference-link" onClick={openReferenceDocument}>
                  {formatLocationLabel(issue.related_location, issue.related_location_number)} ↗
                </button>
              ) : (
                formatLocationLabel(issue.related_location, issue.related_location_number)
              )}
            </>
          )}
        </span>
      </div>
      <div className="rule-evidence-block">
        <span className="rule-evidence-label">규칙 설명</span>
        <p className="rule-evidence-text">{getRuleDescription(issue)}</p>
      </div>
      {/* 예외 상황 데이터가 없으면(지금은 항상 없음) 행 자체를 그리지 않는다 — 빈 텍스트로 채우지 않는다. */}
      {exception && (
        <div className="rule-evidence-block">
          <span className="rule-evidence-label">예외 상황</span>
          <p className="rule-evidence-text">{exception}</p>
        </div>
      )}
    </div>
  )
}
