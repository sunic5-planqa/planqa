import { useCallback, useEffect } from 'react'
import type { ExtractConfluenceContentRequest, ExtractConfluenceContentResponse } from '../content/messages'
import { useAppDispatch } from '../state/hooks'

export function useConfluenceAutoDetect(): { detect: () => void } {
  const dispatch = useAppDispatch()

  const detect = useCallback(() => {
    dispatch({ type: 'CONFLUENCE_DETECT_START' })

    void (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        if (!tab.id) {
          dispatch({ type: 'CONFLUENCE_NOT_A_PAGE' })
          return
        }

        const response = await chrome.tabs.sendMessage<ExtractConfluenceContentRequest, ExtractConfluenceContentResponse>(
          tab.id,
          { type: 'EXTRACT_CONFLUENCE_CONTENT' },
        )

        if (response.ok) {
          dispatch({ type: 'CONFLUENCE_DETECTED', title: response.title, markdown: response.markdown })
        } else if (response.error === 'NOT_A_CONFLUENCE_PAGE') {
          dispatch({ type: 'CONFLUENCE_NOT_A_PAGE' })
        } else {
          dispatch({ type: 'CONFLUENCE_DETECT_FAILED', error: '컨플루언스 페이지에서 불러오지 못했습니다.' })
        }
      } catch {
        // chrome.tabs.sendMessage rejects when the active tab has no content script listener —
        // the common case when the panel is opened on a non-Confluence tab.
        dispatch({ type: 'CONFLUENCE_NOT_A_PAGE' })
      }
    })()
  }, [dispatch])

  useEffect(() => {
    detect()
  }, [detect])

  return { detect }
}
