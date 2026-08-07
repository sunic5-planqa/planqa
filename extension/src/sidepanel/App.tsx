import { ErrorBanner } from '../components/common/ErrorBanner'
import { HistoryExportScreen } from '../components/screens/HistoryExportScreen'
import { IssueListScreen } from '../components/screens/IssueListScreen'
import { LoadingScreen } from '../components/screens/LoadingScreen'
import { MainScreen } from '../components/screens/MainScreen'
import { ProgressScreen } from '../components/screens/ProgressScreen'
import { useIssueOverlaySync } from '../hooks/useIssueOverlaySync'
import { useAppState } from '../state/hooks'

export function App() {
  const { screen, error } = useAppState()
  useIssueOverlaySync()

  return (
    <main className="app">
      {error && screen !== 'main' && <ErrorBanner message={error} />}
      {screen === 'main' && <MainScreen />}
      {screen === 'loading' && <LoadingScreen />}
      {screen === 'progress' && <ProgressScreen />}
      {screen === 'issues' && <IssueListScreen />}
      {screen === 'history' && <HistoryExportScreen />}
    </main>
  )
}
