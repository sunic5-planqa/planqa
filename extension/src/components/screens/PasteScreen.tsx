import { useState } from 'react'
import { api } from '../../api/client'
import { NotImplementedError } from '../../api/errors'
import type { ExtractConfluenceContentRequest, ExtractConfluenceContentResponse } from '../../content/messages'
import { useAppDispatch, useAppState } from '../../state/hooks'
import { Button } from '../common/Button'
import { ErrorBanner } from '../common/ErrorBanner'

const QA_FACTORS = ['문서 전체', '챕터', '문단', '문장'] as const

export function PasteScreen() {
  const { rawText, error } = useAppState()
  const dispatch = useAppDispatch()
  const [submitting, setSubmitting] = useState(false)
  const [importing, setImporting] = useState(false)

  const handleImportFromConfluence = async () => {
    setImporting(true)
    dispatch({ type: 'SET_ERROR', error: null })

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab.id) {
        dispatch({ type: 'SET_ERROR', error: '현재 탭을 찾을 수 없습니다.' })
        return
      }

      const response = await chrome.tabs.sendMessage<ExtractConfluenceContentRequest, ExtractConfluenceContentResponse>(
        tab.id,
        { type: 'EXTRACT_CONFLUENCE_CONTENT' },
      )

      if (response.ok) {
        dispatch({ type: 'SET_RAW_TEXT', rawText: response.markdown })
      } else if (response.error === 'NOT_A_CONFLUENCE_PAGE') {
        dispatch({ type: 'SET_ERROR', error: '컨플루언스 페이지가 아닙니다.' })
      } else {
        dispatch({ type: 'SET_ERROR', error: '컨플루언스 페이지에서 불러오지 못했습니다.' })
      }
    } catch {
      dispatch({ type: 'SET_ERROR', error: '컨플루언스 페이지에서 불러오지 못했습니다.' })
    } finally {
      setImporting(false)
    }
  }

  const handleStart = async () => {
    if (!rawText.trim()) return

    setSubmitting(true)
    dispatch({ type: 'SET_ERROR', error: null })

    try {
      const doc = await api.createDocument(rawText)
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
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="screen paste-screen">
      <h1>써니C — 기획서 QA</h1>
      <p className="hint">기획서 텍스트를 붙여넣어주세요. #, ## 로 챕터/문단 구조를 표시할 수 있습니다.</p>

      <Button variant="secondary" onClick={() => void handleImportFromConfluence()} disabled={importing}>
        {importing ? '불러오는 중...' : '컨플루언스에서 가져오기'}
      </Button>

      <textarea
        value={rawText}
        onChange={(e) => dispatch({ type: 'SET_RAW_TEXT', rawText: e.target.value })}
        placeholder="# 기획서 제목&#10;&#10;## 배경&#10;&#10;..."
        rows={12}
      />

      <fieldset className="qa-factors">
        <legend>QA Factors</legend>
        {QA_FACTORS.map((factor) => (
          <label key={factor}>
            <input type="checkbox" checked readOnly />
            {factor}
          </label>
        ))}
      </fieldset>

      {error && <ErrorBanner message={error} />}

      <Button onClick={() => void handleStart()} disabled={submitting || !rawText.trim()}>
        {submitting ? '처리 중...' : 'QA 시작'}
      </Button>
    </div>
  )
}
