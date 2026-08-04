import { useContext, type Dispatch } from 'react'
import type { Action } from './appReducer'
import { AppDispatchContext, AppStateContext } from './context'
import type { AppState } from './types'

export function useAppState(): AppState {
  const state = useContext(AppStateContext)
  if (!state) throw new Error('useAppState must be used within AppStateProvider')
  return state
}

export function useAppDispatch(): Dispatch<Action> {
  const dispatch = useContext(AppDispatchContext)
  if (!dispatch) throw new Error('useAppDispatch must be used within AppStateProvider')
  return dispatch
}
