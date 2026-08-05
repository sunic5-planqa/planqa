import { useEffect } from 'react'
import type { ListSiblingPagesRequest, ListSiblingPagesResponse } from '../content/messages'
import { useAppDispatch, useAppState } from '../state/hooks'

export function useConfluenceSiblingDocs(): void {
  const { confluenceStatus } = useAppState()
  const dispatch = useAppDispatch()

  useEffect(() => {
    if (confluenceStatus !== 'detected') return

    dispatch({ type: 'CONFLUENCE_SIBLINGS_DETECT_START' })

    void (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        if (!tab.id) {
          dispatch({ type: 'CONFLUENCE_SIBLINGS_DETECT_FAILED' })
          return
        }

        const response = await chrome.tabs.sendMessage<ListSiblingPagesRequest, ListSiblingPagesResponse>(tab.id, {
          type: 'LIST_SIBLING_PAGES',
        })

        if (response.ok) {
          dispatch({ type: 'CONFLUENCE_SIBLINGS_LOADED', docs: response.siblings })
        } else if (response.error === 'NO_PARENT') {
          dispatch({ type: 'CONFLUENCE_SIBLINGS_NO_PARENT' })
        } else {
          dispatch({ type: 'CONFLUENCE_SIBLINGS_DETECT_FAILED' })
        }
      } catch {
        dispatch({ type: 'CONFLUENCE_SIBLINGS_DETECT_FAILED' })
      }
    })()
  }, [confluenceStatus, dispatch])
}
