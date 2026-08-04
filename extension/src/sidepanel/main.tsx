import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppStateProvider } from '../state/AppStateContext'
import '../styles/global.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppStateProvider>
      <App />
    </AppStateProvider>
  </StrictMode>,
)
