import { useCallback, useEffect } from 'react'
import { api } from '../api/client'
import type {
  ExtractConfluenceContentRequest,
  ExtractConfluenceContentResponse,
  QaPassedBadgeResponse,
  ShowQaPassedBadgeRequest,
} from '../content/messages'
import { useAppDispatch } from '../state/hooks'

// 페이지 로드마다 백엔드에 "이 컨플루언스 페이지, 예전에 QA 통과했나?"를 물어서 배지를 켠다 —
// 익스텐션 로컬/세션 상태가 아니라 백엔드 조회 결과만으로 켜져야 새로고침/재방문에도 유지된다
// ("QA 통과 배지 백엔드 영속화", 2026-08-30). 실패해도 조용히 넘어간다 — 배지는 부가 정보라
// 메인 감지 흐름을 막을 이유가 없다.
async function showBadgeIfAlreadyPassed(tabId: number, pageId: string): Promise<void> {
  try {
    const status = await api.getQaStatusByPage(pageId)
    if (!status.passed) return
    await chrome.tabs.sendMessage<ShowQaPassedBadgeRequest, QaPassedBadgeResponse>(tabId, {
      type: 'SHOW_QA_PASSED_BADGE',
    })
  } catch {
    // 백엔드가 꺼져 있거나 콘텐츠 스크립트가 없는 경우 — 배지 없이 그냥 넘어간다.
  }
}

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
          dispatch({
            type: 'CONFLUENCE_DETECTED',
            title: response.title,
            markdown: response.markdown,
            pageId: response.pageId,
            tabId: tab.id,
          })
          void showBadgeIfAlreadyPassed(tab.id, response.pageId)
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
