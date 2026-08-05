import { useState } from 'react'
import { api } from '../../api/client'
import { NotImplementedError } from '../../api/errors'
import { useConfluenceAutoDetect } from '../../hooks/useConfluenceAutoDetect'
import { useAppDispatch, useAppState } from '../../state/hooks'
import { Button } from '../common/Button'
import { ErrorBanner } from '../common/ErrorBanner'
import { ReferencesSection } from '../main/ReferencesSection'

export function MainScreen() {
  const { confluenceStatus, confluencePageTitle, confluenceMarkdown, error } = useAppState()
  const dispatch = useAppDispatch()
  const { detect } = useConfluenceAutoDetect()
  const [submitting, setSubmitting] = useState(false)

  // TODO(qa-engine): selectedReferenceFileIds (state/types.ts) is collected but not yet sent to
  // the backend — there's no consumer until the QA engine (feature/qa-engine-llm-client) lands
  // and the Document/QAJob models grow a field for it.
  const handleStart = async () => {
    if (!confluenceMarkdown) return

    setSubmitting(true)
    dispatch({ type: 'SET_ERROR', error: null })
    dispatch({ type: 'NAVIGATE', screen: 'loading' })

    try {
      const doc = await api.createDocument(confluenceMarkdown)
      dispatch({ type: 'DOCUMENT_CREATED', documentId: doc.document_id, parsedStructure: doc.parsed_structure })

      try {
        const job = await api.createQAJob(doc.document_id)
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

  return (
    <div className="screen main-screen">
      <h1>AI QA Service</h1>

      <div className="confluence-status">
        {confluenceStatus === 'detecting' && <p className="hint">리뷰 대상 확인 중...</p>}
        {confluenceStatus === 'detected' && <p className="hint">리뷰 대상: {confluencePageTitle}</p>}
        {confluenceStatus === 'not_confluence' && (
          <p className="hint">컨플루언스 페이지가 아닙니다. 컨플루언스 페이지를 열고 다시 확인해주세요.</p>
        )}
        {confluenceStatus === 'error' && <p className="hint">문서를 불러오지 못했습니다.</p>}
        <Button variant="secondary" onClick={detect} disabled={confluenceStatus === 'detecting'}>
          다시 확인
        </Button>
      </div>

      <ReferencesSection />

      {error && <ErrorBanner message={error} />}

      <Button onClick={() => void handleStart()} disabled={submitting || confluenceStatus !== 'detected'}>
        {submitting ? '처리 중...' : 'QA 시작 ▶'}
      </Button>
    </div>
  )
}
