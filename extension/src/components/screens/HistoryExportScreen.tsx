import { diffWords } from 'diff'
import { useState } from 'react'
import type { IssueResponse } from '../../api/types'
import type { ScrollToLocationRequest, ScrollToLocationResponse } from '../../content/messages'
import { useAppDispatch, useAppState } from '../../state/hooks'
import type { IssueEdit } from '../../state/types'
import { Button } from '../common/Button'

// 최종 텍스트는 실제로 편집해서 저장한 값(edit.editedText — SUGGESTION_EDIT_SAVED가 문서에 PUT한
// 바로 그 문자열)이어야 한다. 예전엔 'apply'(수정 완료로 표시만 하고 문서는 안 건드린 경우)에
// issue.suggestion(AI 제안 문구)을 대신 보여줬는데, 실제로 문서에 반영된 적 없는 문구를 "수정본"
// 인 것처럼 보여주는 셈이라 오해를 준다는 피드백으로 수정 — 'apply'는 원문 그대로 돌려주고,
// 아래 렌더링에서 "변경 없음"으로 표시한다(2026-08-30).
function resolveReplacement(issue: IssueResponse, edit: IssueEdit | undefined): string | null {
  if (!edit || edit.action === 'skip') return null
  return edit.action === 'edit' ? (edit.editedText ?? issue.input_text) : issue.input_text
}

// 원본 전체를 회색 취소선으로, 수정본 전체를 그 아래 따로 보여주던 기존 방식(문단 두 줄 통짜
// 대비) 대신, 한 문단 안에서 실제로 달라진 단어만 삭제선/강조로 보여준다 — diffWords는 공백
// 기준 토큰화라 띄어쓰기가 있는 한국어 문장에도 문제없이 동작한다.
function renderInlineDiff(original: string, revised: string) {
  return diffWords(original, revised).map((part, index) => {
    if (part.added) {
      return (
        <mark key={index} className="diff-added">
          {part.value}
        </mark>
      )
    }
    if (part.removed) {
      return (
        <del key={index} className="diff-removed">
          {part.value}
        </del>
      )
    }
    return <span key={index}>{part.value}</span>
  })
}

type ViewMode = 'original' | 'revised'

export function HistoryExportScreen() {
  const { issues, issueEdits, confluenceTabId } = useAppState()
  const dispatch = useAppDispatch()
  const [viewMode, setViewMode] = useState<ViewMode>('revised')
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null)

  const resolvedIssues = issues
    .map((issue) => ({ issue, replacement: resolveReplacement(issue, issueEdits[issue.id]) }))
    .filter((entry): entry is { issue: IssueResponse; replacement: string } => entry.replacement !== null)

  // chrome.tabs.query({active:true})로 매번 다시 찾지 않고 문서를 처음 감지한 탭(confluenceTabId)
  // 에 고정해서 보낸다 — 그렇지 않으면 이 화면을 보는 동안 다른 탭에 가 있을 때 스크롤 요청이
  // 엉뚱한 탭으로 가서 조용히 실패한다(useSuggestionOverlaySync.ts와 동일한 이유, 2026-08-30).
  const goToLocation = async (issue: IssueResponse) => {
    setSelectedIssueId(issue.id)
    if (confluenceTabId === null) return
    try {
      await chrome.tabs.sendMessage<ScrollToLocationRequest, ScrollToLocationResponse>(confluenceTabId, {
        type: 'SCROLL_TO_LOCATION',
        location: { text: issue.input_text, location: issue.location },
      })
    } catch {
      // 문서 탭이 닫혔거나 콘텐츠 스크립트가 없으면 조용히 무시 — 목록 선택 표시 자체는 그대로 유효하다.
    }
  }

  // "적용 및 종료"라는 문구는 이슈별로 이미 개별 저장(수정 저장)이 끝난 뒤라 이 시점엔 새로 "적용"할
  // 게 없어서 정확하지 않다고 판단 — 여기서 하는 일은 검토를 마치고 처음 화면으로 돌아가는 것뿐이라
  // "검토 종료"로 바꿨다. 원본은 이 리뷰 내내 한 번도 덮어써지지 않았고(전부 복제본에 저장됨), 이
  // 버튼도 원본과는 무관하다. 백엔드에 QA 통과를 기록하는 건 이 화면 이전(SuggestionSummaryScreen
  // 도달 시점)으로 옮겨졌다 — 여기 버튼 하나를 더 눌러야만 배지가 켜지던 문제 때문(2026-08-30).
  const finishReview = () => {
    dispatch({ type: 'NAVIGATE', screen: 'main' })
  }

  // "QA 완료"를 눌러 여기 왔다가 마음이 바뀌어 이슈를 더 보고/고치고 싶을 수 있다는 피드백 —
  // 그냥 이슈 화면으로 돌아간다(activeIssueId 등 기존 상태는 그대로라 보던 자리에서 이어짐).
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
                onClick={() => void goToLocation(issue)}
              >
                {viewMode === 'original' ? (
                  <span className="diff-text">{issue.input_text}</span>
                ) : replacement === issue.input_text ? (
                  <span className="diff-text diff-unchanged">변경 없음</span>
                ) : (
                  <span className="diff-text">
                    <span className="diff-revised-check">✓</span> {renderInlineDiff(issue.input_text, replacement)}
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
