import { useEffect } from 'react'
import type {
  ClearIssueOverlayRequest,
  ClearIssueOverlayResponse,
  IssueOverlayFocusMessage,
  OverlayIssue,
  ScrollToIssueRequest,
  ScrollToIssueResponse,
  ShowIssueOverlayRequest,
  ShowIssueOverlayResponse,
} from '../content/messages'
import { useAppDispatch, useAppState } from '../state/hooks'

async function sendToActiveTab<Req, Res>(message: Req): Promise<Res | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab.id) return null
  try {
    return await chrome.tabs.sendMessage<Req, Res>(tab.id, message)
  } catch {
    // 콘텐츠 스크립트가 없는 탭(컨플루언스/목 서버가 아닌 탭)에서는 조용히 무시 — 정상 케이스.
    return null
  }
}

// 이슈 목록/최종 검토(history) 화면이 떠 있는 동안 문서 본문에 하이라이트 오버레이를 얹고, 본문의
// 하이라이트(또는 그 말풍선)를 클릭했을 때 오른쪽 패널이 해당 이슈의 편집 모드로 바로 전환되도록
// 포커스를 맞춘다 — 실제 수정/저장 자체는 IssueListScreen이 APPLY_ISSUE_EDIT 요청으로 직접 처리한다.
// history 화면에서도 오버레이를 켜 두는 이유: SCREEN 05의 "검토 내역 클릭 → 본문 이동"이 동작하려면
// 그 시점에도 하이라이트가 문서에 남아있어야 한다.
export function useIssueOverlaySync(): void {
  const { screen, issues, currentIssueIndex } = useAppState()
  const dispatch = useAppDispatch()
  const overlayActive = (screen === 'issues' || screen === 'history') && issues.length > 0
  const currentIssueId = issues[currentIssueIndex]?.id

  useEffect(() => {
    if (!overlayActive) return

    const overlayIssues: OverlayIssue[] = issues.map((issue) => ({
      id: issue.id,
      input_text: issue.input_text,
      criteria: issue.criteria,
      reason: issue.reason,
      suggestion: issue.suggestion,
    }))

    void sendToActiveTab<ShowIssueOverlayRequest, ShowIssueOverlayResponse>({
      type: 'SHOW_ISSUE_OVERLAY',
      issues: overlayIssues,
    })

    return () => {
      void sendToActiveTab<ClearIssueOverlayRequest, ClearIssueOverlayResponse>({ type: 'CLEAR_ISSUE_OVERLAY' })
    }
  }, [overlayActive, issues])

  // 오른쪽 패널에서 보고 있는 이슈가 바뀔 때마다(이전/다음, Overview 카드 클릭, 문서 하이라이트 클릭으로
  // 포커스 이동 등) 문서 본문도 그 하이라이트가 보이는 위치로 따라 스크롤한다.
  useEffect(() => {
    if (!overlayActive || !currentIssueId) return
    void sendToActiveTab<ScrollToIssueRequest, ScrollToIssueResponse>({ type: 'SCROLL_TO_ISSUE', issueId: currentIssueId })
  }, [overlayActive, currentIssueId])

  useEffect(() => {
    const listener = (message: IssueOverlayFocusMessage) => {
      if (message.type !== 'ISSUE_OVERLAY_FOCUS') return
      dispatch({ type: 'SELECT_ISSUE_BY_ID', issueId: message.issueId })
      dispatch({ type: 'START_EDIT_ISSUE', issueId: message.issueId })
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [dispatch])
}
