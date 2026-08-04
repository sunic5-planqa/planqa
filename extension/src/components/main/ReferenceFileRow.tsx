import type { ReferenceFile } from '../../state/types'
import { useAppDispatch, useAppState } from '../../state/hooks'

export function ReferenceFileRow({ file }: { file: ReferenceFile }) {
  const { selectedReferenceFileIds } = useAppState()
  const dispatch = useAppDispatch()

  return (
    <div className="reference-file-row">
      <label>
        <input
          type="checkbox"
          checked={selectedReferenceFileIds.includes(file.id)}
          onChange={() => dispatch({ type: 'TOGGLE_REFERENCE_FILE', fileId: file.id })}
        />
        {file.name}
      </label>
      <button
        type="button"
        className="remove-file-btn"
        onClick={() => dispatch({ type: 'REMOVE_REFERENCE_FILE', fileId: file.id })}
        aria-label={`${file.name} 제거`}
      >
        ✕
      </button>
    </div>
  )
}
