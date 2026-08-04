import { createContext, type Dispatch } from 'react'
import type { Action } from './appReducer'
import type { AppState } from './types'

export const AppStateContext = createContext<AppState | undefined>(undefined)
export const AppDispatchContext = createContext<Dispatch<Action> | undefined>(undefined)
