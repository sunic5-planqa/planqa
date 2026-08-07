import { useState } from 'react'
import type { FetchPageMarkdownRequest, FetchPageMarkdownResponse } from '../../content/messages'
import type { ConfluenceSiblingDoc } from '../../state/types'
import { useAppDispatch, useAppState } from '../../state/hooks'

export function ConfluenceSiblingRow({ doc }: { doc: ConfluenceSiblingDoc }) {
  const { selectedReferenceFileIds } = useAppState()
  const dispatch = useAppDispatch()
  const [fetching, setFetching] = useState(false)
  const checked = selectedReferenceFileIds.includes(doc.id)

  const handleCheck = async () => {
    if (checked) {
      dispatch({ type: 'REMOVE_REFERENCE_FILE', fileId: doc.id })
      return
    }

    setFetching(true)
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab.id) return

      const response = await chrome.tabs.sendMessage<FetchPageMarkdownRequest, FetchPageMarkdownResponse>(tab.id, {
        type: 'FETCH_PAGE_MARKDOWN',
        pageId: doc.id,
      })

      if (response.ok) {
        const file = { id: doc.id, name: response.title, content: response.markdown }
        dispatch({ type: 'REFERENCE_FILES_ADDED', files: [file] })
      } else {
        dispatch({ type: 'SET_ERROR', error: `"${doc.title}" 문서를 불러오지 못했습니다.` })
      }
    } catch {
      dispatch({ type: 'SET_ERROR', error: `"${doc.title}" 문서를 불러오지 못했습니다.` })
    } finally {
      setFetching(false)
    }
  }

  return (
    <div className="reference-file-row">
      <label>
        <input type="checkbox" checked={checked} disabled={fetching} onChange={() => void handleCheck()} />
        <span className="reference-checkbox-box" aria-hidden="true" />
        {doc.title}
      </label>
      {fetching && <span className="hint">불러오는 중...</span>}
    </div>
  )
}
