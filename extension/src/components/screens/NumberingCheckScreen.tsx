import { useEffect, useState } from 'react'
import type { NumberingIssueResponse } from '../../api/types'
import type {
  ApplyIssueEditRequest,
  ApplyIssueEditResponse,
  ClearQaPassedBadgeRequest,
  FlushPendingEditsRequest,
  FlushPendingEditsResponse,
  QaPassedBadgeResponse,
  ScrollToLocationRequest,
  ScrollToLocationResponse,
  ShowQaPassedBadgeRequest,
} from '../../content/messages'
import { deriveDefaultChecked } from '../../state/numberingChecklist'
import { useAppDispatch, useAppState } from '../../state/hooks'
import { fetchLiveNumberingIssues } from '../../utils/numberingReverify'
import { numberingIssueToScrollLocation } from '../../utils/numberingLocation'
import { Button } from '../common/Button'

// 재검증마다 id가 전부 새로 발급되므로(아래 주석), 실패 메시지를 그대로 들고 있으면 다음 렌더에서
// 엉뚱한(또는 존재하지 않는) id를 가리키게 된다. 아직 안 고쳐진 항목은 location+before_text가
// 그대로 유지되니, 그걸로 옛 항목과 새 항목을 짝지어 에러를 옮겨준다 — 짝이 안 맞으면(고쳐졌거나
// 사라졌으면) 버린다.
function remapRowErrors(
  prevErrors: Record<string, string>,
  oldIssues: NumberingIssueResponse[],
  newIssues: NumberingIssueResponse[],
): Record<string, string> {
  if (Object.keys(prevErrors).length === 0) return {}
  const errorByKey = new Map<string, string>()
  for (const issue of oldIssues) {
    const message = prevErrors[issue.id]
    if (message) errorByKey.set(`${issue.location}::${issue.before_text}`, message)
  }
  const next: Record<string, string> = {}
  for (const issue of newIssues) {
    const message = errorByKey.get(`${issue.location}::${issue.before_text}`)
    if (message) next[issue.id] = message
  }
  return next
}

// 넘버링 하모나이징 — QA의 마지막 사용자 확인 단계다. 넘버링 오류가 있든 없든 이 화면에 진입하고,
// "넘버링 적용"은 체크한 항목만 문서에 반영한 뒤 이 화면에 그대로 머문다(사용자가 실제 문서에서
// 결과를 확인할 수 있어야 한다). QA 프로세스는 사용자가 "검토종료"를 직접 눌렀을 때만 끝난다.
export function NumberingCheckScreen() {
  const { numberingIssues, jobId, confluenceTabId } = useAppState()
  const dispatch = useAppDispatch()

  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => deriveDefaultChecked(numberingIssues))
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [topError, setTopError] = useState<string | null>(null)
  const [appliedNotice, setAppliedNotice] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [finishingReview, setFinishingReview] = useState(false)

  // 마지막 확인 화면에서도 문서 제목 옆 "✓ QA 통과" 배지가 보이도록, 요약 화면과 같은 방식으로
  // 이 화면이 떠 있는 동안 배지를 켜둔다.
  useEffect(() => {
    if (confluenceTabId === null) return
    void chrome.tabs
      .sendMessage<ShowQaPassedBadgeRequest, QaPassedBadgeResponse>(confluenceTabId, { type: 'SHOW_QA_PASSED_BADGE' })
      .catch(() => {})
    return () => {
      void chrome.tabs
        .sendMessage<ClearQaPassedBadgeRequest, QaPassedBadgeResponse>(confluenceTabId, {
          type: 'CLEAR_QA_PASSED_BADGE',
        })
        .catch(() => {})
    }
  }, [confluenceTabId])

  // 적용 후 재검증(NUMBERING_ISSUES_LOADED)으로 목록이 통째로 새로 오면(id도 전부 새로 발급됨)
  // 체크 상태/에러/선택을 그 새 목록 기준으로 다시 초기화한다.
  const [seenIssues, setSeenIssues] = useState(numberingIssues)
  if (numberingIssues !== seenIssues) {
    setRowErrors((prev) => remapRowErrors(prev, seenIssues, numberingIssues))
    setSeenIssues(numberingIssues)
    setCheckedIds(deriveDefaultChecked(numberingIssues))
    setSelectedId(null)
  }

  const toggle = (id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const goToLocation = async (issueId: string, location: ScrollToLocationRequest['location']) => {
    setSelectedId(issueId)
    if (confluenceTabId === null) return
    try {
      await chrome.tabs.sendMessage<ScrollToLocationRequest, ScrollToLocationResponse>(confluenceTabId, {
        type: 'SCROLL_TO_LOCATION',
        location,
      })
    } catch {
      // 문서 탭이 닫혔거나 콘텐츠 스크립트가 없으면 조용히 무시 — 선택 표시 자체는 유효하다.
    }
  }

  const applySelected = async () => {
    if (!jobId) return
    setAppliedNotice(null)
    setTopError(null)

    const toApply = numberingIssues.filter((item) => checkedIds.has(item.id) && item.after_text !== null)
    if (toApply.length === 0) {
      setTopError('반영할 항목이 없습니다. 수정할 항목을 선택해주세요.')
      return
    }

    setApplying(true)

    const newRowErrors: Record<string, string> = {}
    let appliedCount = 0
    // 재검증은 이 중 마지막으로 저장이 실제 성공한 pageId로 한다 — AppState의 confluencePageId는
    // 최초 감지 시점 스냅샷이라 탭이 다른 컨플루언스 페이지로 이동했으면 stale할 수 있다(코드
    // 리뷰로 확인된 버그, 2026-10-01).
    let lastAppliedPageId: string | null = null

    if (confluenceTabId === null) {
      setTopError('컨플루언스 탭을 찾을 수 없습니다.')
      setApplying(false)
      return
    }
    for (const item of toApply) {
      try {
        const response = await chrome.tabs.sendMessage<ApplyIssueEditRequest, ApplyIssueEditResponse>(confluenceTabId, {
          type: 'APPLY_ISSUE_EDIT',
          issueId: item.id,
          oldText: item.before_text,
          newText: item.after_text as string,
        })
        if (response.ok) {
          appliedCount += 1
          lastAppliedPageId = response.pageId
        } else {
          newRowErrors[item.id] = response.error
        }
      } catch (err) {
        newRowErrors[item.id] = err instanceof Error ? err.message : String(err)
      }
    }

    // 개별 적용 실패는 재검증 성공 여부와 무관하게 항상 화면에 반영한다 — 재검증 쪽에서만
    // throw하고 여기서 못 멈추면, 라이브 페이지엔 이미 반영된 수정의 row 에러가 조용히
    // 사라져 사용자가 뭐가 실패했는지 알 수 없게 된다(코드 리뷰로 확인된 버그, 2026-10-01).
    setRowErrors(newRowErrors)
    const hasFailures = Object.keys(newRowErrors).length > 0

    if (appliedCount === 0) {
      setTopError(`${Object.keys(newRowErrors).length}건 수정에 실패했어요. 다시 시도하거나 체크를 해제할 수 있어요.`)
      setApplying(false)
      return
    }

    try {
      // 방금 반영한 수정이 실제로 들어간 라이브 페이지를 다시 읽어서 재검증한다 — 예전엔 백엔드가
      // 따로 들고 있던 사본을 로컬 문자열 치환으로 패치해 재검증했는데, 그 사본이 실제 저장된
      // 내용과 어긋나면(마크다운 추출 차이, 같은 문구가 본문에 또 있는 경우 등) 어긋난 목록에서
      // 나온 다음 "넘버링 적용"이 이미 고쳐둔 다른 부분을 엉뚱하게 덮어써 "방금 고친 게 롤백된
      // 것처럼" 보이는 실사용 버그로 이어졌다(2026-10-01) — 1회차 검증(finishQA)과 동일하게
      // 항상 라이브 재조회 기준으로만 판단한다.
      if (lastAppliedPageId === null) throw new Error('문서 페이지 id를 확인할 수 없습니다.')
      const remaining = await fetchLiveNumberingIssues(confluenceTabId, lastAppliedPageId, jobId)
      if (remaining === null) throw new Error('문서 최신 내용을 다시 불러오지 못했습니다.')

      if (hasFailures) {
        setTopError(`${Object.keys(newRowErrors).length}건 수정에 실패했어요. 다시 시도하거나 체크를 해제할 수 있어요.`)
      }
      setAppliedNotice(`${appliedCount}건을 문서에 반영했어요. 문서에서 결과를 확인한 뒤 검토를 종료하세요.`)
      // 목록을 재검증 결과로 갱신하되, 화면은 그대로 유지한다(어떤 화면으로도 이동하지 않는다).
      dispatch({ type: 'NUMBERING_ISSUES_LOADED', issues: remaining })
    } catch (err) {
      // 이 시점에 던져진 에러는 재검증 단계(라이브 재조회)만 실패한 것이다 — appliedCount건은
      // 이미 라이브 페이지에 반영됐으니, "아무것도 안 됐다"로 오인하지 않게 그 사실도 같이 보여준다.
      const reverifyError = err instanceof Error ? err.message : String(err)
      setTopError(`${appliedCount}건은 반영됐지만, 최신 상태 재확인에 실패했어요: ${reverifyError}`)
    } finally {
      setApplying(false)
    }
  }

  // "검토종료" — 이슈를 옮겨다니는 동안 저장 버튼을 안 거친 채 편집된 문단이 있으면(스냅샷 참고,
  // issueOverlay.ts) 화면을 넘어가기 전에 한 번 더 모아서 저장한다. 실패하면 화면 전환을 막아,
  // 실패한 수정이 조용히 사라지지 않게 한다.
  const finishReview = async () => {
    if (confluenceTabId === null) {
      dispatch({ type: 'NAVIGATE', screen: 'main' })
      return
    }
    setFinishingReview(true)
    setTopError(null)
    try {
      const response = await chrome.tabs.sendMessage<FlushPendingEditsRequest, FlushPendingEditsResponse>(
        confluenceTabId,
        { type: 'FLUSH_PENDING_EDITS' },
      )
      if (!response.ok) {
        setTopError(`저장하지 못한 수정이 있어요: ${response.error}`)
        return
      }
      dispatch({ type: 'NAVIGATE', screen: 'main' })
    } catch (err) {
      setTopError(err instanceof Error ? err.message : String(err))
    } finally {
      setFinishingReview(false)
    }
  }

  return (
    <div className="screen numbering-check-screen">
      <div className="screen-scroll">
        <img className="panel-logo" src="/logo-icon.svg" alt="똑독" />
        <hr className="panel-divider" />

        <h2 className="numbering-check-heading">넘버링 하모나이징</h2>

        {numberingIssues.length === 0 ? (
          <p className="hint">넘버링 오류가 없습니다. 문서를 확인한 뒤 검토를 종료하세요.</p>
        ) : (
          <p className="hint">문서에서 넘버링 오류를 발견했습니다. 수정할 항목을 선택하고 반영해주세요.</p>
        )}

        {appliedNotice && <p className="issue-edit-notice">{appliedNotice}</p>}
        {topError && <p className="issue-edit-notice issue-edit-notice-error">{topError}</p>}

        <ul className="numbering-check-list">
          {numberingIssues.map((item) => (
            <li
              key={item.id}
              className={`numbering-check-item ${selectedId === item.id ? 'numbering-check-item-selected' : ''}`.trim()}
            >
              <input
                type="checkbox"
                className="numbering-check-checkbox"
                checked={checkedIds.has(item.id)}
                disabled={applying || finishingReview}
                onChange={() => toggle(item.id)}
                aria-label={`${item.location} 수정 선택`}
              />
              {/* 카드 본문 어디를 눌러도 문서의 해당 위치로 이동한다. 체크박스는 이 영역 밖의
                  형제라 클릭이 겹치지 않는다. */}
              <div
                className="numbering-check-item-body"
                role="button"
                tabIndex={0}
                onClick={() => void goToLocation(item.id, numberingIssueToScrollLocation(item))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    void goToLocation(item.id, numberingIssueToScrollLocation(item))
                  }
                }}
              >
                <div className="numbering-check-item-top">
                  <span className={`numbering-status-badge numbering-status-badge-${item.status}`}>
                    {item.status === 'auto' ? '🟢 자동 수정 가능' : '🟡 확인 필요'}
                  </span>
                  <span className="numbering-check-item-location">{item.location} ↗</span>
                </div>
                <p className="numbering-check-item-problem">{item.problem}</p>
                <p className="numbering-check-item-diff">
                  {item.after_text ? (
                    <>
                      <span className="numbering-check-before">{item.before_text}</span>
                      {' → '}
                      <span className="numbering-check-after">{item.after_text}</span>
                    </>
                  ) : (
                    <span className="numbering-check-before">{item.before_text}</span>
                  )}
                </p>
                {rowErrors[item.id] && (
                  <p className="issue-edit-notice issue-edit-notice-error">{rowErrors[item.id]}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="screen-footer numbering-check-footer">
        <div className="numbering-check-footer-actions">
          {numberingIssues.length > 0 && (
            <Button variant="outline-pill" onClick={() => void applySelected()} disabled={applying || finishingReview}>
              넘버링 적용
            </Button>
          )}
          <Button className="btn-cta" onClick={() => void finishReview()} disabled={applying || finishingReview}>
            {finishingReview ? '저장 확인 중...' : '검토종료'}
          </Button>
        </div>
      </div>
    </div>
  )
}
