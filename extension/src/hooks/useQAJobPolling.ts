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
        if (status.status === 'failed') {
          // 이슈 0건으로 끝나는 실제 "문제 없음" 케이스와 구분해야 한다 — 예전엔 failed도 done과
          // 똑같이 취급해서 그냥 빈 이슈 목록을 불러왔는데, 그러면 "AI 키 설정을 안 해서 검토
          // 자체가 실패"한 것도 화면엔 "발견된 이슈가 없습니다"로 보여서 구분이 안 됐다.
          stop()
          dispatch({ type: 'SET_ERROR', error: 'QA 검토가 실패했습니다. 서버의 API 키 설정을 확인해주세요.' })
          return
        }
        if (status.status === 'done') {
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
