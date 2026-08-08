import { CategoryTree } from '../progress/CategoryTree'
import { useQAJobPolling } from '../../hooks/useQAJobPolling'
import { useAppDispatch, useAppState } from '../../state/hooks'
import { Button } from '../common/Button'

// 마스코트 폭(.mascot-on-track의 width와 일치) — 진행률 100%에서도 트랙 밖으로 안 튀어나가게
// "이동 가능한 폭(트랙 폭 - 마스코트 폭)"만큼만 움직이도록 left를 계산하는 데 쓴다.
const MASCOT_TRACK_WIDTH_PX = 40

export function ProgressScreen() {
  const { jobId, jobStatus, qaEngineUnavailable } = useAppState()
  const dispatch = useAppDispatch()

  useQAJobPolling(jobId)

  return (
    <div className="screen progress-screen">
      <h1 className="panel-title">AI QA Service</h1>
      <hr className="panel-divider" />

      {jobStatus ? (
        <div className="progress-track">
          <div
            className="mascot mascot-walk mascot-on-track"
            style={{ left: `calc((100% - ${MASCOT_TRACK_WIDTH_PX}px) * ${jobStatus.progress} / 100)` }}
          >
            <img src="/mascot/walk.png" alt="" />
          </div>
          <div className="progress-bar">
            <div className="progress-bar-track">
              <div className="progress-bar-fill" style={{ width: `${jobStatus.progress}%` }} />
            </div>
            <span className="progress-bar-label">{jobStatus.progress}%</span>
          </div>
        </div>
      ) : (
        <div className="mascot mascot-walk">
          <img src="/mascot/walk.png" alt="" />
        </div>
      )}

      {qaEngineUnavailable && <p className="notice">QA 엔진 준비중 — 데모용 미리보기 데이터를 표시합니다.</p>}

      {jobStatus && (
        <>
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
