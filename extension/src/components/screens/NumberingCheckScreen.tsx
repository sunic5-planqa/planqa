import { useState } from 'react'
import { api } from '../../api/client'
import type { AppliedNumberingFix } from '../../api/types'
import type { ApplyIssueEditRequest, ApplyIssueEditResponse } from '../../content/messages'
import { deriveDefaultChecked } from '../../state/numberingChecklist'
import { useAppDispatch, useAppState } from '../../state/hooks'
import { Button } from '../common/Button'

export function NumberingCheckScreen() {
  const { numberingIssues, jobId } = useAppState()
  const dispatch = useAppDispatch()

  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => deriveDefaultChecked(numberingIssues))
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [topError, setTopError] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)

  // 적용 후 재검증(NUMBERING_ISSUES_LOADED)으로 목록이 통째로 새로 오면(id도 전부 새로 발급됨)
  // 체크 상태/에러를 그 새 목록 기준으로 다시 초기화한다. useEffect 대신 렌더 중 비교로 처리해
  // 불필요한 추가 렌더 패스를 피한다(React 공식 "Adjusting state based on props" 패턴).
  const [seenIssues, setSeenIssues] = useState(numberingIssues)
  if (numberingIssues !== seenIssues) {
    setSeenIssues(numberingIssues)
    setCheckedIds(deriveDefaultChecked(numberingIssues))
    setRowErrors({})
  }

  const toggle = (id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const applySelected = async () => {
    if (!jobId) return

    // 체크된(그리고 실제로 적용 가능한) 항목이 하나도 없으면 "수정하지 않고 종료"와 동일 —
    // 문서가 안 바뀌니 재검증 없이 곧장 검토를 마친다.
    const toApply = numberingIssues.filter((item) => checkedIds.has(item.id) && item.after_text !== null)
    if (toApply.length === 0) {
      dispatch({ type: 'NAVIGATE', screen: 'history' })
      return
    }

    setApplying(true)
    setTopError(null)

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

    // 반영 시도가 전부 실패했으면(선택은 했지만 아무것도 안 먹혔으면) 재검증할 이유가 없다 —
    // 문서가 안 바뀌었으니 지금 보이는 목록이 곧 최신 상태다.
    if (appliedFixes.length === 0) {
      setRowErrors(newRowErrors)
      setTopError(`${Object.keys(newRowErrors).length}건 수정에 실패했어요. 다시 시도하거나 체크를 해제하고 종료할 수 있어요.`)
      setApplying(false)
      return
    }

    try {
      const remaining = await api.applyNumberingFixes(jobId, appliedFixes)
      const hasFailures = Object.keys(newRowErrors).length > 0
      if (remaining.length === 0 && !hasFailures) {
        dispatch({ type: 'NAVIGATE', screen: 'history' })
        return
      }
      setRowErrors(newRowErrors)
      if (hasFailures) {
        setTopError(`${Object.keys(newRowErrors).length}건 수정에 실패했어요. 다시 시도하거나 체크를 해제하고 종료할 수 있어요.`)
      }
      // 남은 오류를 다시 보여준다 — 검토 종료로는 아직 넘어가지 않는다.
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
        <h1 className="panel-title">똑독</h1>
        <hr className="panel-divider" />

        <h2 className="numbering-check-heading">넘버링 오류를 확인해주세요</h2>
        <p className="hint">문서에서 넘버링 오류를 발견했습니다. 수정할 항목을 선택해주세요.</p>

        {topError && <p className="issue-edit-notice issue-edit-notice-error">{topError}</p>}

        <ul className="numbering-check-list">
          {numberingIssues.map((item) => (
            <li key={item.id} className="numbering-check-item">
              <input
                type="checkbox"
                className="numbering-check-checkbox"
                checked={checkedIds.has(item.id)}
                disabled={applying}
                onChange={() => toggle(item.id)}
              />
              <div className="numbering-check-item-body">
                <div className="numbering-check-item-top">
                  <span className={`numbering-status-badge numbering-status-badge-${item.status}`}>
                    {item.status === 'auto' ? '🟢 자동 수정 가능' : '🟡 확인 필요'}
                  </span>
                  <span className="numbering-check-item-location">{item.location}</span>
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
        <Button className="btn-cta" onClick={() => void applySelected()} disabled={applying}>
          선택 항목 수정 후 검토 종료
        </Button>
      </div>
    </div>
  )
}
