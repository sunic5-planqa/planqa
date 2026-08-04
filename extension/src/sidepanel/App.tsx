import { ErrorBanner } from '../components/common/ErrorBanner'
import { HistoryExportScreen } from '../components/screens/HistoryExportScreen'
import { IssueEditScreen } from '../components/screens/IssueEditScreen'
import { IssueListScreen } from '../components/screens/IssueListScreen'
import { PasteScreen } from '../components/screens/PasteScreen'
import { ProgressScreen } from '../components/screens/ProgressScreen'
import { useAppState } from '../state/hooks'

export function App() {
  const { screen, error } = useAppState()

  return (
    <main className="app">
      {error && screen !== 'paste' && <ErrorBanner message={error} />}
      {screen === 'paste' && <PasteScreen />}
      {screen === 'progress' && <ProgressScreen />}
      {screen === 'issues' && <IssueListScreen />}
      {screen === 'edit' && <IssueEditScreen />}
      {screen === 'history' && <HistoryExportScreen />}
    </main>
  )
}
