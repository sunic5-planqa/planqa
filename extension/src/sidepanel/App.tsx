import { ErrorBanner } from '../components/common/ErrorBanner'
import { HistoryExportScreen } from '../components/screens/HistoryExportScreen'
import { LoadingScreen } from '../components/screens/LoadingScreen'
import { MainScreen } from '../components/screens/MainScreen'
import { NumberingCheckScreen } from '../components/screens/NumberingCheckScreen'
import { ProgressScreen } from '../components/screens/ProgressScreen'
import { SuggestionDetailScreen } from '../components/screens/SuggestionDetailScreen'
import { SuggestionListScreen } from '../components/screens/SuggestionListScreen'
import { SuggestionSummaryScreen } from '../components/screens/SuggestionSummaryScreen'
import { TeamRulesScreen } from '../components/screens/TeamRulesScreen'
import { useSuggestionOverlaySync } from '../hooks/useSuggestionOverlaySync'
import { useAppState } from '../state/hooks'

export function App() {
  const { screen, activeIssueId, error } = useAppState()
  useSuggestionOverlaySync()

  return (
    <main className="app">
      {error && screen !== 'main' && <ErrorBanner message={error} />}
      {screen === 'main' && <MainScreen />}
      {screen === 'loading' && <LoadingScreen />}
      {screen === 'progress' && <ProgressScreen />}
      {screen === 'issues' && (activeIssueId ? <SuggestionDetailScreen /> : <SuggestionListScreen />)}
      {screen === 'suggestion-summary' && <SuggestionSummaryScreen />}
      {screen === 'numbering-check' && <NumberingCheckScreen />}
      {screen === 'history' && <HistoryExportScreen />}
      {screen === 'team-rules' && <TeamRulesScreen />}
    </main>
  )
}
