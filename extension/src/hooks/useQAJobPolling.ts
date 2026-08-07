import { useEffect, useRef } from 'react'
import { api } from '../api/client'
import { NotImplementedError } from '../api/errors'
import { FIXTURE_ISSUES, FIXTURE_JOB_STATUS } from '../api/fixtures'
import { buildDemoIssues } from '../state/demoIssues'
import { useAppDispatch, useAppState } from '../state/hooks'

const POLL_INTERVAL_MS = 1500

export function useQAJobPolling(jobId: string | null): void {
  const dispatch = useAppDispatch()
  const { qaEngineUnavailable, parsedStructure } = useAppState()
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!jobId) return

    if (qaEngineUnavailable) {
      dispatch({ type: 'JOB_STATUS_UPDATED', status: FIXTURE_JOB_STATUS })
      // 지금 실제로 열려있는 문서의 실제 문장으로 데모 이슈를 만들어야, 어떤 컨플루언스 페이지에서
      // 열든 인라인 오버레이 하이라이트가 실제 본문 위에서 정확히 매칭된다.
      const demoIssues = parsedStructure ? buildDemoIssues(parsedStructure) : []
      dispatch({ type: 'ISSUES_LOADED', issues: demoIssues.length > 0 ? demoIssues : FIXTURE_ISSUES })
      return
    }

    const poll = async () => {
      try {
        const status = await api.getQAJobStatus(jobId)
        dispatch({ type: 'JOB_STATUS_UPDATED', status })
        if (status.status === 'done' || status.status === 'failed') {
          stop()
          const issues = await api.listQAJobIssues(jobId)
          dispatch({ type: 'ISSUES_LOADED', issues })
        }
      } catch (error) {
        if (error instanceof NotImplementedError) {
          stop()
          dispatch({ type: 'QA_ENGINE_UNAVAILABLE' })
          dispatch({ type: 'JOB_STATUS_UPDATED', status: FIXTURE_JOB_STATUS })
        } else {
          dispatch({ type: 'SET_ERROR', error: error instanceof Error ? error.message : String(error) })
        }
      }
    }

    const stop = () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }

    void poll()
    intervalRef.current = setInterval(() => void poll(), POLL_INTERVAL_MS)

    return stop
  }, [jobId, qaEngineUnavailable, parsedStructure, dispatch])
}
