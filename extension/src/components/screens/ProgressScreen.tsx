import { CategoryTree } from '../progress/CategoryTree'
import { useQAJobPolling } from '../../hooks/useQAJobPolling'
import { useAppDispatch, useAppState } from '../../state/hooks'
import { Button } from '../common/Button'

export function ProgressScreen() {
  const { jobId, jobStatus, qaEngineUnavailable } = useAppState()
  const dispatch = useAppDispatch()

  useQAJobPolling(jobId)

  return (
    <div className="screen progress-screen">
      <h1 className="panel-title">AI QA Service</h1>
      <hr className="panel-divider" />

      <div className="mascot mascot-walk">
        <img src="/mascot/walk.png" alt="" />
      </div>

      {qaEngineUnavailable && <p className="notice">QA 엔진 준비중 — 데모용 미리보기 데이터를 표시합니다.</p>}

      {jobStatus && (
        <>
          <div className="progress-bar">
            <div className="progress-bar-fill" style={{ width: `${jobStatus.progress}%` }} />
            <span className="progress-bar-label">{jobStatus.progress}%</span>
          </div>
          <p className="hint">진행 경과 시간: {jobStatus.elapsed_seconds.toFixed(0)}초</p>

          {jobStatus.categories && <CategoryTree categories={jobStatus.categories} />}
        </>
      )}

      <div className="qa-start-row">
        <Button variant="secondary" className="btn-bracket" onClick={() => dispatch({ type: 'NAVIGATE', screen: 'main' })}>
          QA 중지 Ⅱ
        </Button>
      </div>
    </div>
  )
}
