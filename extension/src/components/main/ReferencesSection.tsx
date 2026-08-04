import { useAppDispatch, useAppState } from '../../state/hooks'
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
  const { referenceFiles, selectedReferenceFileIds } = useAppState()
  const dispatch = useAppDispatch()

  const handleFilesPicked = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return
    const files = await readFiles(fileList)
    dispatch({ type: 'REFERENCE_FILES_ADDED', files })
  }

  return (
    <fieldset className="references-section">
      <legend>References (선택된 문서: {selectedReferenceFileIds.length}개)</legend>

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

      {referenceFiles.length === 0 ? (
        <p className="hint">참조할 마크다운 파일을 선택해주세요.</p>
      ) : (
        <div className="reference-file-list">
          {referenceFiles.map((file) => (
            <ReferenceFileRow key={file.id} file={file} />
          ))}
        </div>
      )}
    </fieldset>
  )
}
