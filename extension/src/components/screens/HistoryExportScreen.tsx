import { useState } from 'react'
import type { IssueResponse } from '../../api/types'
import type { ScrollToIssueRequest, ScrollToIssueResponse } from '../../content/messages'
import { useAppDispatch, useAppState } from '../../state/hooks'
import type { IssueEdit } from '../../state/types'
import { Button } from '../common/Button'

function resolveReplacement(issue: IssueResponse, edit: IssueEdit | undefined): string | null {
  if (!edit || edit.action === 'skip') return null
  return edit.action === 'edit' ? (edit.editedText ?? issue.input_text) : issue.suggestion
}

type ViewMode = 'original' | 'revised'

export function HistoryExportScreen() {
  const { issues, issueEdits } = useAppState()
  const dispatch = useAppDispatch()
  const [viewMode, setViewMode] = useState<ViewMode>('revised')
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null)

  const resolvedIssues = issues
    .map((issue) => ({ issue, replacement: resolveReplacement(issue, issueEdits[issue.id]) }))
    .filter((entry): entry is { issue: IssueResponse; replacement: string } => entry.replacement !== null)

  const goToIssue = async (issueId: string) => {
    setSelectedIssueId(issueId)
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab.id) return
    try {
      await chrome.tabs.sendMessage<ScrollToIssueRequest, ScrollToIssueResponse>(tab.id, { type: 'SCROLL_TO_ISSUE', issueId })
    } catch {
      // 콘텐츠 스크립트가 없는 탭이면 조용히 무시 — 목록 선택 표시 자체는 그대로 유효하다.
    }
  }

  // "적용 및 종료"라는 문구는 이슈별로 이미 개별 저장(수정 저장)이 끝난 뒤라 이 시점엔 새로 "적용"할
  // 게 없어서 정확하지 않다고 판단 — 여기서 하는 일은 검토를 마치고 처음 화면으로 돌아가는 것뿐이라
  // "검토 종료"로 바꿨다. 원본은 이 리뷰 내내 한 번도 덮어써지지 않았고(전부 복제본에 저장됨), 이
  // 버튼도 원본과는 무관하다.
  const finishReview = () => {
    dispatch({ type: 'NAVIGATE', screen: 'main' })
  }

  // "QA 완료"를 눌러 여기 왔다가 마음이 바뀌어 이슈를 더 보고/고치고 싶을 수 있다는 피드백 —
  // 그냥 이슈 화면으로 돌아간다(currentIssueIndex 등 기존 상태는 그대로라 보던 자리에서 이어짐).
  const goBackToIssues = () => {
    dispatch({ type: 'NAVIGATE', screen: 'issues' })
  }

  return (
    <div className="screen history-export-screen">
      <div className="screen-scroll">
        <h1 className="panel-title">똑독</h1>
        <hr className="panel-divider" />

        <div className="history-header-row">
          <h2 className="history-heading">QA 검토</h2>
          <div className="view-toggle" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'original'}
              className={`view-toggle-option ${viewMode === 'original' ? 'view-toggle-option-active' : ''}`.trim()}
              onClick={() => setViewMode('original')}
            >
              원본
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'revised'}
              className={`view-toggle-option ${viewMode === 'revised' ? 'view-toggle-option-active' : ''}`.trim()}
              onClick={() => setViewMode('revised')}
            >
              수정본
            </button>
          </div>
        </div>

        {resolvedIssues.length === 0 ? (
          <p className="hint">적용되거나 수정된 항목이 없습니다.</p>
        ) : (
          <div className="diff-list">
            {resolvedIssues.map(({ issue, replacement }) => (
              <button
                key={issue.id}
                type="button"
                className={`diff-item ${selectedIssueId === issue.id ? 'diff-item-selected' : ''}`.trim()}
                onClick={() => void goToIssue(issue.id)}
              >
                <span className="diff-original">{issue.input_text}</span>
                {viewMode === 'revised' && (
                  <span className="diff-revised">
                    <span className="diff-revised-check">✓</span> {replacement}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="screen-footer history-footer">
        <button type="button" className="history-back-link" onClick={goBackToIssues}>
          ← 이슈 목록으로
        </button>
        <Button className="btn-cta" onClick={finishReview}>
          검토 종료
        </Button>
      </div>
    </div>
  )
}
