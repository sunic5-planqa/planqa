import { useEffect, useReducer, type ReactNode } from 'react'
import { appReducer } from './appReducer'
import { AppDispatchContext, AppStateContext } from './context'
import { initialAppState } from './types'

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialAppState)

  // TEMPORARY — 3a~3d 수동 확인용 디버그 훅. 실제 QA 엔진(API 키) 없이도 콘솔에서
  // window.__sunnicDebug.dispatch(...)로 화면을 바로 확인할 수 있게 한다. PR 올리기 전에
  // 이 useEffect 블록은 지워야 한다(커밋 대상 아님).
  useEffect(() => {
    ;(window as unknown as { __sunnicDebug?: { dispatch: typeof dispatch } }).__sunnicDebug = { dispatch }
  }, [dispatch])

  return (
    <AppStateContext.Provider value={state}>
      <AppDispatchContext.Provider value={dispatch}>{children}</AppDispatchContext.Provider>
    </AppStateContext.Provider>
  )
}
