import { useEffect } from 'react'
import { api } from '../api/client'
import { NotImplementedError } from '../api/errors'
import type {
  ClearIssueOverlayRequest,
  ClearIssueOverlayResponse,
  IssueOverlayResolvedMessage,
  OverlayIssue,
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

// 이슈 목록/수정 화면이 떠 있는 동안 문서 본문에 하이라이트 오버레이를 얹고, 본문에서 직접
// "오류 수정하기"를 눌렀을 때의 결과를 사이드패널 상태(issueEdits)로 반영한다.
export function useIssueOverlaySync(): void {
  const { screen, issues } = useAppState()
  const dispatch = useAppDispatch()
  const overlayActive = (screen === 'issues' || screen === 'edit') && issues.length > 0

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

  useEffect(() => {
    const listener = (message: IssueOverlayResolvedMessage) => {
      if (message.type !== 'ISSUE_OVERLAY_RESOLVED') return
      dispatch({ type: 'STAGE_ISSUE_EDIT', issueId: message.issueId, action: 'edit', editedText: message.editedText })
      api.updateIssue(message.issueId, { action: 'edit', edited_text: message.editedText }).catch((err: unknown) => {
        if (!(err instanceof NotImplementedError)) {
          dispatch({ type: 'SET_ERROR', error: err instanceof Error ? err.message : String(err) })
        }
      })
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [dispatch])
}
