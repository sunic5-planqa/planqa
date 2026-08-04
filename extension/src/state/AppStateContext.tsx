import { useReducer, type ReactNode } from 'react'
import { appReducer } from './appReducer'
import { AppDispatchContext, AppStateContext } from './context'
import { initialAppState } from './types'

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialAppState)

  return (
    <AppStateContext.Provider value={state}>
      <AppDispatchContext.Provider value={dispatch}>{children}</AppDispatchContext.Provider>
    </AppStateContext.Provider>
  )
}
