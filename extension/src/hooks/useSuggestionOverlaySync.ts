import { useEffect } from 'react'
import type { IssueResponse } from '../api/types'
import type {
  ClearActiveSuggestionRequest,
  ClearActiveSuggestionResponse,
  EditableSuggestionLocation,
  SetActiveSuggestionRequest,
  SetActiveSuggestionResponse,
  SuggestionLocation,
} from '../content/messages'
import { useAppState } from '../state/hooks'
import type { IssueEdit } from '../state/types'

// 매번 chrome.tabs.query({active:true})로 "지금 활성 탭"을 다시 찾으면, 사용자가 패널을 열어둔
// 채 다른 탭(복제본 페이지, DevTools 등)에 가 있는 동안 메시지가 엉뚱한 탭으로 가서 조용히
// 실패한다 — 문서를 처음 감지했을 때의 탭 id(confluenceTabId)에 고정해서 보낸다(실사용 중 마커가
// 전혀 안 뜨는 문제로 확인됨, 2026-08-30).
async function sendToDocumentTab<Req, Res>(tabId: number | null, message: Req): Promise<Res | null> {
  if (tabId === null) {
    console.warn('[SunniC] 문서 탭 id가 아직 없어 메시지를 보내지 못함 (내비게이터/편집 동기화가 안 먹힐 수 있음):', message)
    return null
  }
  try {
    return await chrome.tabs.sendMessage<Req, Res>(tabId, message)
  } catch (err) {
    // 문서 탭이 닫혔거나 콘텐츠 스크립트가 없는 경우 — 최소한 콘솔에는 남긴다.
    console.warn('[SunniC] 문서 탭으로 메시지 전송 실패:', { tabId, message, err })
    return null
  }
}

// 이미 저장된 위치는 문서에 실제로 반영된 텍스트가 원본(input_text/related_original_text)과
// 다르다 — 재순회 시 원본으로 다시 찾으려 하면 매칭이 깨지므로, 저장된 값이 있으면 그걸 기준으로
// 앵커를 찾아야 한다("문서에서 직접 편집"으로 바뀌면서 새로 생긴 요구사항).
function resolvedText(issue: IssueResponse, edit: IssueEdit | undefined, target: 'primary' | 'related'): string {
  if (target === 'related') return edit?.relatedEditedText ?? issue.related_original_text ?? ''
  return edit?.editedText ?? issue.input_text
}

// 3b/3c(상세) 화면에서 지금 작업 중인 제안(activeIssueId)이 바뀌거나 위치 내비게이터로
// primary/related를 오갈 때마다, 문서 본문에 그 위치(current)만 편집 가능하게 틴트하고 나머지는
// 흐리게 만든다. 3a(목록, activeIssueId===null)로 돌아가거나 다른 화면으로 넘어가면 오버레이를
// 지운다. 예전 useIssueOverlaySync와 달리 클릭 기반 포커스는 없다 — 어느 이슈를 볼지는 패널에서
// 고르고, 실제 텍스트 편집만 문서 쪽에서 일어난다.
export function useSuggestionOverlaySync(): void {
  const { screen, issues, activeIssueId, activeLocationIndex, issueEdits, confluenceTabId } = useAppState()

  useEffect(() => {
    if (screen !== 'issues' || !activeIssueId) {
      void sendToDocumentTab<ClearActiveSuggestionRequest, ClearActiveSuggestionResponse>(confluenceTabId, {
        type: 'CLEAR_ACTIVE_SUGGESTION',
      })
      return
    }

    const activeIssue = issues.find((issue) => issue.id === activeIssueId)
    if (!activeIssue) return

    const edit = issueEdits[activeIssueId]
    const hasRelated = !!activeIssue.related_original_text
    const primaryLoc: SuggestionLocation = {
      text: resolvedText(activeIssue, edit, 'primary'),
      location: activeIssue.location,
    }
    const relatedLoc: SuggestionLocation | null = hasRelated
      ? { text: resolvedText(activeIssue, edit, 'related'), location: activeIssue.related_location ?? activeIssue.location }
      : null

    // activeLocationIndex===1(내비게이터로 관련 위치를 보는 중)이면 current/related를 뒤바꿔서
    // 보낸다 — content script 입장에서 "current"는 편집 가능한 실선 틴트가 붙는 쪽이다. related
    // 위치를 편집 중일 땐 비교 기준이 될 "AI 제안"이 없어서 suggestion을 null로 보낸다(저장 전
    // AI 유사도 체크를 건너뛰라는 신호 — 패널의 기존 편집 로직과 동일한 규칙).
    const viewingRelated = activeLocationIndex === 1 && hasRelated
    const current: EditableSuggestionLocation = viewingRelated
      ? { ...(relatedLoc as SuggestionLocation), criteria: activeIssue.criteria, reason: activeIssue.reason, suggestion: null }
      : { ...primaryLoc, criteria: activeIssue.criteria, reason: activeIssue.reason, suggestion: activeIssue.suggestion }
    const related = viewingRelated ? primaryLoc : relatedLoc

    const doneLocations: SuggestionLocation[] = issues
      .filter((issue) => issue.id !== activeIssueId && issueEdits[issue.id] !== undefined)
      .map((issue) => ({ text: resolvedText(issue, issueEdits[issue.id], 'primary'), location: issue.location }))

    void sendToDocumentTab<SetActiveSuggestionRequest, SetActiveSuggestionResponse>(confluenceTabId, {
      type: 'SET_ACTIVE_SUGGESTION',
      current,
      related,
      doneLocations,
    })
  }, [screen, issues, activeIssueId, activeLocationIndex, issueEdits, confluenceTabId])
}
