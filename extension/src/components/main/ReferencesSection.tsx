import { useConfluenceSiblingDocs } from '../../hooks/useConfluenceSiblingDocs'
import { useAppDispatch, useAppState } from '../../state/hooks'
import { ConfluenceSiblingRow } from './ConfluenceSiblingRow'
import { ReferenceFileRow } from './ReferenceFileRow'

async function readFiles(fileList: FileList): Promise<{ id: string; name: string; content: string }[]> {
  return Promise.all(
    Array.from(fileList).map(async (file) => ({
      id: crypto.randomUUID(),
      name: file.name,
      content: await file.text(),
    })),
  )
}

export function ReferencesSection() {
  const { referenceFiles, selectedReferenceFileIds, confluenceSiblingStatus, confluenceSiblingDocs } = useAppState()
  const dispatch = useAppDispatch()

  useConfluenceSiblingDocs()

  const siblingIds = new Set(confluenceSiblingDocs.map((doc) => doc.id))
  const localFiles = referenceFiles.filter((file) => !siblingIds.has(file.id))

  const handleFilesPicked = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return
    const files = await readFiles(fileList)
    dispatch({ type: 'REFERENCE_FILES_ADDED', files })
  }

  return (
    <fieldset className="references-section">
      <legend>References (선택된 문서: {selectedReferenceFileIds.length}개)</legend>

      <div className="reference-subsection">
        <p className="reference-subsection-heading">컨플루언스 형제 문서</p>
        {confluenceSiblingStatus === 'loading' && <p className="hint">같은 폴더의 다른 문서를 찾는 중...</p>}
        {confluenceSiblingStatus === 'no_parent' && <p className="hint">상위 문서가 없어 형제 문서를 찾을 수 없습니다.</p>}
        {confluenceSiblingStatus === 'error' && <p className="hint">형제 문서를 불러오지 못했습니다.</p>}
        {confluenceSiblingStatus === 'loaded' && confluenceSiblingDocs.length === 0 && (
          <p className="hint">같은 폴더에 다른 문서가 없습니다.</p>
        )}
        {confluenceSiblingStatus === 'loaded' && confluenceSiblingDocs.length > 0 && (
          <div className="reference-file-list">
            {confluenceSiblingDocs.map((doc) => (
              <ConfluenceSiblingRow key={doc.id} doc={doc} />
            ))}
          </div>
        )}
      </div>

      <div className="reference-subsection">
        <p className="reference-subsection-heading">로컬 파일</p>
        <label className="file-picker-button">
          📎 파일 선택
          <input
            type="file"
            accept=".md,text/markdown"
            multiple
            onChange={(e) => {
              void handleFilesPicked(e.target.files)
              e.target.value = ''
            }}
          />
        </label>

        {localFiles.length === 0 ? (
          <p className="hint">참조할 마크다운 파일을 선택해주세요.</p>
        ) : (
          <div className="reference-file-list">
            {localFiles.map((file) => (
              <ReferenceFileRow key={file.id} file={file} />
            ))}
          </div>
        )}
      </div>
    </fieldset>
  )
}
