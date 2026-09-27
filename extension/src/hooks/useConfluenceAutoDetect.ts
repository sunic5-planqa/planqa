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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// 새로고침 직후엔 content script가 리스너를 등록하기 전이라 sendMessage가 "연결할 수 없음"으로
// 실패할 수 있다(SHOW_QA_PASSED_BADGE 재시도와 같은 이유, 2026-08-30 — 실사용자가 탭을 새로고침한
// 직후 확장프로그램을 열어서 "컨플루언스 페이지가 아닙니다"를 실제로 만남, 2026-09-12) —
// "진짜 컨플루언스가 아닌 탭"과 "아직 로딩 중인 탭"이 이 예외 하나로는 구분이 안 되니 몇 번
// 재시도해서 구분한다. 재시도가 다 끝난 뒤에도 실패하면 그때는 정말 없는 걸로 본다.
const DETECT_MAX_RETRIES = 5
const DETECT_RETRY_DELAY_MS = 300

export async function sendExtractRequest(
  tabId: number,
  retriesLeft: number,
): Promise<ExtractConfluenceContentResponse> {
  try {
    return await chrome.tabs.sendMessage<ExtractConfluenceContentRequest, ExtractConfluenceContentResponse>(tabId, {
      type: 'EXTRACT_CONFLUENCE_CONTENT',
    })
  } catch (err) {
    if (retriesLeft <= 0) throw err
    await delay(DETECT_RETRY_DELAY_MS)
    return sendExtractRequest(tabId, retriesLeft - 1)
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

        const response = await sendExtractRequest(tab.id, DETECT_MAX_RETRIES)

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
        // sendExtractRequest가 재시도까지 다 쓰고도 실패 — 이제는 콘텐츠 스크립트가 없는 탭
        // (컨플루언스가 아닌 탭을 보고 있을 때의 흔한 경우)이라고 봐도 된다.
        dispatch({ type: 'CONFLUENCE_NOT_A_PAGE' })
      }
    })()
  }, [dispatch])

  useEffect(() => {
    detect()
  }, [detect])

  return { detect }
}
