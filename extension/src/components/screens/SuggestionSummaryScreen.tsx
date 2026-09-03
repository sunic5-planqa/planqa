import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import type {
  ClearQaPassedBadgeRequest,
  CommitDocumentEditsRequest,
  CommitDocumentEditsResponse,
  FetchPageMarkdownRequest,
  FetchPageMarkdownResponse,
  GetActiveDuplicatePageRequest,
  GetActiveDuplicatePageResponse,
  QaPassedBadgeResponse,
  ShowQaPassedBadgeRequest,
} from '../../content/messages'
import { groupIssuesByCriteria } from '../../state/issueGrouping'
import { useAppDispatch, useAppState } from '../../state/hooks'
import { deriveProgress } from '../../state/suggestionProgress'
import { Button } from '../common/Button'

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

// QA 검토 요약 — 수정사항 검토 화면에서 "수정완료"를 누르면 온다. QA 결과를 요약해서만 보여주고
// (원본/수정본 diff 화면이 아니다), "돌아가기"로 수정사항 검토로 되돌아가거나 "넘버링 확인"으로
// 마지막 단계(넘버링 하모나이징)로 넘어간다.
export function SuggestionSummaryScreen() {
  const { issues, issueEdits, confluenceTabId, documentId, confluencePageId, jobId, confluenceMarkdown } = useAppState()
  const dispatch = useAppDispatch()
  const [finishingQA, setFinishingQA] = useState(false)

  const progress = deriveProgress(issues, issueEdits)
  const skippedCount = issues.filter((issue) => issueEdits[issue.id]?.action === 'skip').length
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

  // 여기 도달한 시점에 바로 백엔드에 QA 통과를 기록한다 — 실패해도 조용히 넘어간다(배지가 아직
  // 안 켜질 뿐, 검토 자체는 진행 중이라 막을 이유가 없다).
  useEffect(() => {
    if (!documentId || !confluencePageId) return
    api.updateQaStatus(documentId, confluencePageId, true).catch(() => {
      console.warn('[SunniC] QA 통과 상태 저장 실패 — 새로고침 시 배지가 안 뜰 수 있음')
    })
  }, [documentId, confluencePageId])

  // 넘버링 검증은 AI QA와 별개 영역이라 여기서 새로 조회한다. AI QA 리뷰 중 적용한 수정은 원본이
  // 아니라 별도 "복제본" 페이지에 쌓이므로(원본은 절대 안 건드림), 복제본이 있으면 그 최신 내용을
  // 가져오고, 아직 복제본이 없으면(= 아무 수정도 적용 안 했으면) 원본 페이지를 다시 가져온다 — 이때
  // AppState의 기존 confluenceMarkdown을 그대로 재사용하지 않는다: 그건 AI QA용으로 추출된 것이라
  // 본문 h1이 h2와 같은 레벨로 뭉개져 있어서(review_agent 청크 분할용 — confluenceParser.ts 참고),
  // 대주제를 Heading 1로 쓴 실제 문서에서 대주제/소주제가 전부 한 그룹으로 섞여 오탐이 났었다(실사용
  // 확인된 버그). preserveHeadingLevels:true로 다시 받아 h1~h6 원래 레벨을 그대로 보존한다.
  // 넘버링 하모나이징은 QA의 마지막 사용자 확인 단계라, 오류가 0건이든 조회가 실패하든 항상 그
  // 화면으로 보낸다(NUMBERING_ISSUES_LOADED에 빈 배열이라도 넘긴다).
  const finishQA = async () => {
    if (!jobId) {
      dispatch({ type: 'NUMBERING_ISSUES_LOADED', issues: [] })
      return
    }
    setFinishingQA(true)
    try {
      const commitResponse = await sendToDocumentTab<CommitDocumentEditsRequest, CommitDocumentEditsResponse>(
        confluenceTabId,
        { type: 'COMMIT_DOCUMENT_EDITS' },
      )
      if (commitResponse && !commitResponse.ok) {
        console.warn('[SunniC] 좌측 문서 편집분 동기화 실패 — 넘버링 검증이 최신 상태를 못 볼 수 있음', commitResponse.error)
      }

      let freshText = confluenceMarkdown
      const dupResponse = await sendToDocumentTab<GetActiveDuplicatePageRequest, GetActiveDuplicatePageResponse>(
        confluenceTabId,
        { type: 'GET_ACTIVE_DUPLICATE_PAGE' },
      )
      const targetPageId = dupResponse?.ok ? (dupResponse.pageId ?? dupResponse.originalPageId) : null
      if (targetPageId) {
        const pageResponse = await sendToDocumentTab<FetchPageMarkdownRequest, FetchPageMarkdownResponse>(
          confluenceTabId,
          { type: 'FETCH_PAGE_MARKDOWN', pageId: targetPageId, preserveHeadingLevels: true },
        )
        if (pageResponse?.ok) freshText = pageResponse.markdown
      }

      const numberingIssues = freshText ? await api.getNumberingIssues(jobId, freshText) : []
      dispatch({ type: 'NUMBERING_ISSUES_LOADED', issues: numberingIssues })
    } catch {
      dispatch({ type: 'NUMBERING_ISSUES_LOADED', issues: [] })
    } finally {
      setFinishingQA(false)
    }
  }

  return (
    <div className="screen suggestion-summary-screen">
      <div className="screen-scroll">
        <h1 className="panel-title">AI QA Service</h1>
        <hr className="panel-divider" />

        <div className="summary-mascot-card">
          <img className="summary-logo" src="/logo-icon.svg" alt="똑독" />
          <p className="summary-mascot-title">수정 방향성 제안 {progress.total}건 검토를 마쳤어요</p>
        </div>

        <div className="summary-stats-row">
          <div className="summary-stat summary-stat-done">
            <span className="summary-stat-number">{progress.done}</span>
            <span className="summary-stat-label">수정 완료</span>
          </div>
          <div className="summary-stat summary-stat-skipped">
            <span className="summary-stat-number">{progress.skipped}</span>
            <span className="summary-stat-label">건너뜀</span>
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

        {skippedCount > 0 && (
          <p className="hint">건너뛴 제안 {skippedCount}건은 "돌아가기"에서 회색 카드로 다시 확인할 수 있어요.</p>
        )}
      </div>

      <div className="screen-footer suggestion-summary-footer">
        <Button variant="outline-pill" onClick={() => dispatch({ type: 'NAVIGATE', screen: 'issues' })}>
          돌아가기
        </Button>
        <Button className="btn-cta" onClick={() => void finishQA()} disabled={finishingQA}>
          {finishingQA ? '마무리 중...' : '마무리'}
        </Button>
      </div>
    </div>
  )
}
