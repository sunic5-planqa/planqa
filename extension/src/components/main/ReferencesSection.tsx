import { useState } from 'react'
import { useConfluenceSiblingDocs } from '../../hooks/useConfluenceSiblingDocs'
import { useAppState } from '../../state/hooks'
import { ConfluenceSiblingRow } from './ConfluenceSiblingRow'

export function ReferencesSection() {
  const {
    selectedReferenceFileIds,
    confluenceSiblingStatus,
    confluenceParentTitle,
    confluenceSiblingDocs,
    confluenceSiblingError,
  } = useAppState()
  const [expanded, setExpanded] = useState(true)

  useConfluenceSiblingDocs()

  const connected = confluenceSiblingStatus !== 'idle' && confluenceSiblingStatus !== 'error'

  return (
    <div className="references-section">
      <h2 className="references-heading">
        References <span className="references-count">(선택된 문서: {selectedReferenceFileIds.length}개)</span>
      </h2>

      <p className="confluence-db-status">
        Confluence DB
        {connected && <span className="status-dot">● Connected</span>}
      </p>

      {confluenceSiblingStatus === 'loading' && <p className="hint">같은 폴더의 다른 문서를 찾는 중...</p>}
      {confluenceSiblingStatus === 'no_parent' && <p className="hint">상위 문서가 없어 형제 문서를 찾을 수 없습니다.</p>}
      {confluenceSiblingStatus === 'error' && (
        <p className="hint">형제 문서를 불러오지 못했습니다. ({confluenceSiblingError})</p>
      )}

      {confluenceSiblingStatus === 'loaded' && (
        <div className="reference-folder">
          <button type="button" className="folder-toggle" onClick={() => setExpanded((v) => !v)}>
            📁 {confluenceParentTitle} {expanded ? '▼' : '▶'}
          </button>

          {expanded && confluenceSiblingDocs.length === 0 && <p className="hint">같은 폴더에 다른 문서가 없습니다.</p>}

          {expanded && confluenceSiblingDocs.length > 0 && (
            <div className="reference-file-list">
              {confluenceSiblingDocs.map((doc) => (
                <ConfluenceSiblingRow key={doc.id} doc={doc} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
