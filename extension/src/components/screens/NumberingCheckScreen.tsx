import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import type { AppliedNumberingFix } from '../../api/types'
import type {
  ApplyIssueEditRequest,
  ApplyIssueEditResponse,
  ClearQaPassedBadgeRequest,
  QaPassedBadgeResponse,
  ScrollToLocationRequest,
  ScrollToLocationResponse,
  ShowQaPassedBadgeRequest,
} from '../../content/messages'
import { deriveDefaultChecked } from '../../state/numberingChecklist'
import { useAppDispatch, useAppState } from '../../state/hooks'
import { numberingIssueToScrollLocation } from '../../utils/numberingLocation'
import { Button } from '../common/Button'

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

  // 마지막 확인 화면에서도 문서 제목 옆 "✓ QA 통과" 배지가 보이도록, 요약 화면과 같은 방식으로
  // 이 화면이 떠 있는 동안 배지를 켜둔다.
  useEffect(() => {
    if (confluenceTabId === null) return
    void chrome.tabs
      .sendMessage<ShowQaPassedBadgeRequest, QaPassedBadgeResponse>(confluenceTabId, { type: 'SHOW_QA_PASSED_BADGE' })
      .catch(() => {})
    return () => {
      void chrome.tabs
        .sendMessage<ClearQaPassedBadgeRequest, QaPassedBadgeResponse>(confluenceTabId, { type: 'CLEAR_QA_PASSED_BADGE' })
        .catch(() => {})
    }
  }, [confluenceTabId])

  // 적용 후 재검증(NUMBERING_ISSUES_LOADED)으로 목록이 통째로 새로 오면(id도 전부 새로 발급됨)
  // 체크 상태/에러/선택을 그 새 목록 기준으로 다시 초기화한다.
  const [seenIssues, setSeenIssues] = useState(numberingIssues)
  if (numberingIssues !== seenIssues) {
    setSeenIssues(numberingIssues)
    setCheckedIds(deriveDefaultChecked(numberingIssues))
    setRowErrors({})
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
    const appliedFixes: AppliedNumberingFix[] = []

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab.id) {
      setTopError('컨플루언스 탭을 찾을 수 없습니다.')
      setApplying(false)
      return
    }
    for (const item of toApply) {
      try {
        const response = await chrome.tabs.sendMessage<ApplyIssueEditRequest, ApplyIssueEditResponse>(tab.id, {
          type: 'APPLY_ISSUE_EDIT',
          issueId: item.id,
          oldText: item.before_text,
          newText: item.after_text as string,
        })
        if (response.ok) {
          appliedFixes.push({ before_text: item.before_text, after_text: item.after_text as string })
        } else {
          newRowErrors[item.id] = response.error
        }
      } catch (err) {
        newRowErrors[item.id] = err instanceof Error ? err.message : String(err)
      }
    }

    if (appliedFixes.length === 0) {
      setRowErrors(newRowErrors)
      setTopError(`${Object.keys(newRowErrors).length}건 수정에 실패했어요. 다시 시도하거나 체크를 해제할 수 있어요.`)
      setApplying(false)
      return
    }

    try {
      const remaining = await api.applyNumberingFixes(jobId, appliedFixes)
      const hasFailures = Object.keys(newRowErrors).length > 0
      setRowErrors(newRowErrors)
      if (hasFailures) {
        setTopError(`${Object.keys(newRowErrors).length}건 수정에 실패했어요. 다시 시도하거나 체크를 해제할 수 있어요.`)
      }
      setAppliedNotice(`${appliedFixes.length}건을 문서에 반영했어요. 문서에서 결과를 확인한 뒤 검토를 종료하세요.`)
      // 목록을 재검증 결과로 갱신하되, 화면은 그대로 유지한다(어떤 화면으로도 이동하지 않는다).
      dispatch({ type: 'NUMBERING_ISSUES_LOADED', issues: remaining })
    } catch (err) {
      setTopError(err instanceof Error ? err.message : String(err))
    } finally {
      setApplying(false)
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
                disabled={applying}
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
                {rowErrors[item.id] && <p className="issue-edit-notice issue-edit-notice-error">{rowErrors[item.id]}</p>}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="screen-footer numbering-check-footer">
        {numberingIssues.length > 0 && (
          <Button variant="outline-pill" onClick={() => void applySelected()} disabled={applying}>
            넘버링 적용
          </Button>
        )}
        <Button className="btn-cta" onClick={() => dispatch({ type: 'NAVIGATE', screen: 'main' })} disabled={applying}>
          검토종료
        </Button>
      </div>
    </div>
  )
}
