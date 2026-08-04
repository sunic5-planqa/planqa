import { ErrorBanner } from '../components/common/ErrorBanner'
import { HistoryExportScreen } from '../components/screens/HistoryExportScreen'
import { IssueEditScreen } from '../components/screens/IssueEditScreen'
import { IssueListScreen } from '../components/screens/IssueListScreen'
import { MainScreen } from '../components/screens/MainScreen'
import { ProgressScreen } from '../components/screens/ProgressScreen'
import { useAppState } from '../state/hooks'

export function App() {
  const { screen, error } = useAppState()

  return (
    <main className="app">
      {error && screen !== 'main' && <ErrorBanner message={error} />}
      {screen === 'main' && <MainScreen />}
      {screen === 'progress' && <ProgressScreen />}
      {screen === 'issues' && <IssueListScreen />}
      {screen === 'edit' && <IssueEditScreen />}
      {screen === 'history' && <HistoryExportScreen />}
    </main>
  )
}
