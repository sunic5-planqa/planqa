import { useEffect, useRef } from 'react'
import { api } from '../api/client'
import { NotImplementedError } from '../api/errors'
import { FIXTURE_ISSUES, FIXTURE_JOB_STATUS } from '../api/fixtures'
import { useAppDispatch, useAppState } from '../state/hooks'

const POLL_INTERVAL_MS = 1500

export function useQAJobPolling(jobId: string | null): void {
  const dispatch = useAppDispatch()
  const { qaEngineUnavailable } = useAppState()
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!jobId) return

    if (qaEngineUnavailable) {
      dispatch({ type: 'JOB_STATUS_UPDATED', status: FIXTURE_JOB_STATUS })
      dispatch({ type: 'ISSUES_LOADED', issues: FIXTURE_ISSUES })
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
  }, [jobId, qaEngineUnavailable, dispatch])
}
