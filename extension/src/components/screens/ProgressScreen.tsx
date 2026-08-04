import { useQAJobPolling } from '../../hooks/useQAJobPolling'
import { useAppState } from '../../state/hooks'
import { Spinner } from '../common/Spinner'

export function ProgressScreen() {
  const { jobId, jobStatus, qaEngineUnavailable } = useAppState()

  useQAJobPolling(jobId)

  return (
    <div className="screen progress-screen">
      <h1>QA 검증 진행 중</h1>
      <Spinner />

      {qaEngineUnavailable && <p className="notice">QA 엔진 준비중 — 데모용 미리보기 데이터를 표시합니다.</p>}

      {jobStatus && (
        <dl className="progress-details">
          <dt>현재 카테고리</dt>
          <dd>{jobStatus.current_category ?? '-'}</dd>
          <dt>진행률</dt>
          <dd>{jobStatus.progress}%</dd>
          <dt>경과 시간</dt>
          <dd>{jobStatus.elapsed_seconds.toFixed(1)}초</dd>
        </dl>
      )}
    </div>
  )
}
