import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import { NotImplementedError } from '../../api/errors'
import { useConfluenceAutoDetect } from '../../hooks/useConfluenceAutoDetect'
import { useAppDispatch, useAppState } from '../../state/hooks'
import { Button } from '../common/Button'
import { ErrorBanner } from '../common/ErrorBanner'
import { ReferencesSection } from '../main/ReferencesSection'
import { RuleSection } from '../main/RuleSection'

export function MainScreen() {
  const { confluenceStatus, confluenceMarkdown, error, teamCode, referenceFiles, selectedReferenceFileIds } =
    useAppState()
  const dispatch = useAppDispatch()
  const { detect } = useConfluenceAutoDetect()
  const [submitting, setSubmitting] = useState(false)
  const [documentCount, setDocumentCount] = useState<number | null>(null)

  useEffect(() => {
    api
      .getDocumentCount()
      .then((res) => setDocumentCount(res.count))
      .catch(() => {
        // 통계는 부가 정보라 실패해도 그냥 문구를 안 보여줄 뿐, 화면 자체는 그대로 동작해야 한다.
      })
  }, [])

  const handleStart = async () => {
    if (!confluenceMarkdown) return

    setSubmitting(true)
    dispatch({ type: 'SET_ERROR', error: null })
    dispatch({ type: 'NAVIGATE', screen: 'loading' })

    try {
      const doc = await api.createDocument(confluenceMarkdown)
      dispatch({ type: 'DOCUMENT_CREATED', documentId: doc.document_id, parsedStructure: doc.parsed_structure })

      try {
        // 선택된 레퍼런스 문서(References 섹션에서 체크한 형제 문서)는 이미 markdown 내용까지
        // referenceFiles에 받아와 있다 — 타문서 정합성(XDC) 검토가 참고할 수 있으려면 이것도
        // 현재 문서와 똑같이 백엔드에 Document로 먼저 올려서 document_id를 받아야 한다(백엔드
        // reference_document_ids는 store에 이미 있는 문서 id만 인식함).
        const selectedReferenceFiles = referenceFiles.filter((file) => selectedReferenceFileIds.includes(file.id))
        const referenceDocs = await Promise.all(
          selectedReferenceFiles.map((file) => api.createDocument(file.content)),
        )
        const referenceDocumentIds = referenceDocs.map((referenceDoc) => referenceDoc.document_id)

        const job = await api.createQAJob(doc.document_id, teamCode, referenceDocumentIds)
        dispatch({ type: 'JOB_STARTED', jobId: job.job_id })
      } catch (jobError) {
        if (!(jobError instanceof NotImplementedError)) throw jobError
        dispatch({ type: 'QA_ENGINE_UNAVAILABLE' })
        dispatch({ type: 'JOB_STARTED', jobId: 'fixture-job' })
      }
    } catch (docError) {
      dispatch({ type: 'SET_ERROR', error: docError instanceof Error ? docError.message : String(docError) })
      dispatch({ type: 'NAVIGATE', screen: 'main' })
    } finally {
      setSubmitting(false)
    }
  }

  // Figma SCREEN 00("문서 파싱")과 동일하게, 본문을 가져오는 동안은 "리뷰 대상"/"다시 확인" 같은
  // 상태 문구 없이 마스코트 + 로딩바만 보여준다 — 그 문구들은 원래 목업에 없었음.
  if (confluenceStatus === 'idle' || confluenceStatus === 'detecting') {
    return (
      <div className="screen main-screen">
        <h1 className="panel-title">똑독</h1>
        <hr className="panel-divider" />
        <div className="loading-screen">
          <div className="mascot mascot-walk">
            <img src="/mascot/walk.png" alt="" />
          </div>
          <p className="loading-label">본문 가져오는 중...</p>
          <div className="progress-bar-thin">
            <div className="progress-bar-thin-fill" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="screen main-screen">
      <div className="screen-scroll">
        <h1 className="panel-title">똑독</h1>
        <hr className="panel-divider" />

        {(confluenceStatus === 'not_confluence' || confluenceStatus === 'error') && (
          <div className="confluence-status">
            <p className="hint">
              {confluenceStatus === 'not_confluence'
                ? '컨플루언스 페이지가 아닙니다. 컨플루언스 페이지를 열고 다시 확인해주세요.'
                : '문서를 불러오지 못했습니다.'}
            </p>
            <Button variant="secondary" onClick={detect}>
              다시 확인
            </Button>
          </div>
        )}

        <ReferencesSection />
        <RuleSection />

        {error && <ErrorBanner message={error} />}
      </div>

      <div className="screen-footer">
        {documentCount !== null && (
          <p className="review-stats">
            <span className="review-stats-brand">똑독</span>
            <span className="review-stats-muted">으로</span>
            <br />
            <span className="review-stats-muted">{documentCount}건의 문서가 검토됐어요</span>
          </p>
        )}
        <Button className="btn-cta" onClick={() => void handleStart()} disabled={submitting || confluenceStatus !== 'detected'}>
          {submitting ? '처리 중...' : 'QA 시작'}
        </Button>
      </div>
    </div>
  )
}
