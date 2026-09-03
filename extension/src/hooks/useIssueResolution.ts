import { useCallback } from 'react'
import { api } from '../api/client'
import { NotImplementedError } from '../api/errors'
import { useAppDispatch } from '../state/hooks'

// SuggestionDetailScreen(위저드)에 있던 apply/skip 처리 로직을 통합 화면에서 재사용하려고 뽑아낸
// 훅. 각 수정사항 박스가 자기 issueId로 호출한다 — 처리 후 "다음 제안으로 자동 이동"은 하지
// 않는다(통합 화면은 모든 박스를 동시에 보여주므로 이동 개념이 없다). 백엔드 반영은 best-effort:
// QA 엔진이 아직 없어 501이 나면(NotImplementedError) 조용히 넘어가고 로컬 상태만 남긴다.
function persist(issueId: string, body: Parameters<typeof api.updateIssue>[1], onError: (message: string) => void): void {
  void api.updateIssue(issueId, body).catch((err) => {
    if (!(err instanceof NotImplementedError)) onError(err instanceof Error ? err.message : String(err))
  })
}

export function useIssueResolution(issueId: string) {
  const dispatch = useAppDispatch()

  const reportError = useCallback(
    (message: string) => dispatch({ type: 'SET_ERROR', error: message }),
    [dispatch],
  )

  const applyFix = useCallback(() => {
    dispatch({ type: 'STAGE_ISSUE_EDIT', issueId, action: 'apply' })
    persist(issueId, { action: 'apply' }, reportError)
  }, [dispatch, issueId, reportError])

  const skip = useCallback(
    (reason?: string) => {
      dispatch({ type: 'STAGE_ISSUE_EDIT', issueId, action: 'skip', skipReason: reason })
      persist(issueId, { action: 'skip' }, reportError)
    },
    [dispatch, issueId, reportError],
  )

  const unstage = useCallback(() => {
    dispatch({ type: 'UNSTAGE_ISSUE_EDIT', issueId })
  }, [dispatch, issueId])

  return { applyFix, skip, unstage }
}
