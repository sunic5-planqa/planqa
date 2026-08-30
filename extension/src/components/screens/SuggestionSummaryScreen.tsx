import { useEffect } from 'react'
import { api } from '../../api/client'
import type {
  ClearQaPassedBadgeRequest,
  QaPassedBadgeResponse,
  ShowQaPassedBadgeRequest,
} from '../../content/messages'
import { groupIssuesByCriteria } from '../../state/issueGrouping'
import { useAppDispatch, useAppState } from '../../state/hooks'
import { deriveProgress } from '../../state/suggestionProgress'
import { Button } from '../common/Button'
import { Mascot } from '../common/Mascot'

// chrome.tabs.query({active:true})로 매번 다시 찾지 않고 문서를 처음 감지한 탭(confluenceTabId)에
// 고정해서 보낸다 — 그렇지 않으면 이 화면이 떠 있는 동안 다른 탭에 가 있을 때 배지 표시/제거
// 요청이 엉뚱한 탭으로 가서 조용히 실패한다(useSuggestionOverlaySync.ts와 동일한 이유, 2026-08-30).
async function sendToDocumentTab<Req, Res>(tabId: number | null, message: Req): Promise<Res | null> {
  if (tabId === null) return null
  try {
    return await chrome.tabs.sendMessage<Req, Res>(tabId, message)
  } catch {
    return null
  }
}

// 3d — 모든 제안을 처리한 뒤 보여주는 완료 요약. "팀 규칙 충족 현황"은 실제로 팀 규칙 출처 데이터가
// 없어서(판단 지점 #4) criteria(검증기준)별 완료 집계로 대체한다 — 존재하지 않는 규칙명을 지어내지
// 않는다.
export function SuggestionSummaryScreen() {
  const { issues, issueEdits, confluenceTabId, documentId, confluencePageId } = useAppState()
  const dispatch = useAppDispatch()

  const progress = deriveProgress(issues, issueEdits)
  const skippedIssues = issues.filter((issue) => issueEdits[issue.id]?.action === 'skip')
  const complianceGroups = groupIssuesByCriteria(issues).map((group) => ({
    criteria: group.criteria,
    done: group.issues.filter((issue) => {
      const action = issueEdits[issue.id]?.action
      return action === 'apply' || action === 'edit'
    }).length,
    total: group.issues.length,
  }))

  useEffect(() => {
    void sendToDocumentTab<ShowQaPassedBadgeRequest, QaPassedBadgeResponse>(confluenceTabId, { type: 'SHOW_QA_PASSED_BADGE' })
    return () => {
      void sendToDocumentTab<ClearQaPassedBadgeRequest, QaPassedBadgeResponse>(confluenceTabId, { type: 'CLEAR_QA_PASSED_BADGE' })
    }
  }, [confluenceTabId])

  // 이 화면에 도달했다는 것 자체가 잔여 미해결 이슈 0건을 뜻한다(SuggestionDetailScreen의
  // advanceAfterResolving이 getNextOpenIssueId===null일 때만 여기로 보낸다) — 그래서 "검토
  // 종료"라는 별도 버튼을 한 번 더 누르지 않아도 여기 도달한 시점에 바로 백엔드에 QA 통과를
  // 기록한다. 예전엔 다음 화면(HistoryExportScreen)의 "검토 종료" 버튼에만 이 호출이 있었는데,
  // 이 화면의 "QA 완료" 버튼이 사실상 완료로 읽혀서 사용자가 그 다음 버튼을 안 누르고 끝내는
  // 경우 배지가 영영 안 켜지는 문제로 확인됨(2026-08-30). 실패해도 조용히 넘어간다 — 배지가
  // 아직 안 켜질 뿐, 검토 자체는 이미 끝난 상태라 막을 이유가 없다.
  useEffect(() => {
    if (!documentId || !confluencePageId) return
    api.updateQaStatus(documentId, confluencePageId, true).catch(() => {
      console.warn('[SunniC] QA 통과 상태 저장 실패 — 새로고침 시 배지가 안 뜰 수 있음')
    })
  }, [documentId, confluencePageId])

  return (
    <div className="screen suggestion-summary-screen">
      <div className="screen-scroll">
        <h1 className="panel-title">AI QA Service</h1>
        <hr className="panel-divider" />

        <div className="summary-mascot-card">
          <Mascot />
          <p className="summary-mascot-title">수정 방향성 제안 {progress.total}건을 모두 처리했어요</p>
        </div>

        <div className="summary-stats-row">
          <div className="summary-stat summary-stat-done">
            <span className="summary-stat-number">{progress.done}</span>
            <span className="summary-stat-label">수정 완료</span>
          </div>
          <div className="summary-stat summary-stat-skipped">
            <span className="summary-stat-number">{progress.skipped}</span>
            <span className="summary-stat-label">사유 남기고 건너뜀</span>
          </div>
        </div>

        {complianceGroups.length > 0 && (
          <div className="compliance-section">
            <h2 className="compliance-heading">검증기준 충족 현황</h2>
            {complianceGroups.map((group) => (
              <div key={group.criteria} className="compliance-row">
                <span className="compliance-row-label">{group.criteria}</span>
                <span className="compliance-row-count">
                  {group.done} / {group.total} 통과
                </span>
              </div>
            ))}
          </div>
        )}

        {skippedIssues.length > 0 && (
          <button type="button" className="summary-skipped-card" onClick={() => dispatch({ type: 'NAVIGATE', screen: 'history' })}>
            <span>건너뛴 제안 {skippedIssues.length}건</span>
            <span className="summary-skipped-link">기록 보기 →</span>
          </button>
        )}
      </div>

      <div className="screen-footer suggestion-summary-footer">
        <Button variant="outline-pill" onClick={() => dispatch({ type: 'NAVIGATE', screen: 'main' })}>
          다시 검사
        </Button>
        <Button className="btn-cta" onClick={() => dispatch({ type: 'NAVIGATE', screen: 'history' })}>
          QA 완료
        </Button>
      </div>
    </div>
  )
}
