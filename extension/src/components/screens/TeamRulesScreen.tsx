import { useEffect, useRef, useState } from 'react'
import { api } from '../../api/client'
import type { TeamRuleInput } from '../../api/types'
import { useAppDispatch, useAppState } from '../../state/hooks'
import { ErrorBanner } from '../common/ErrorBanner'
import { TeamRuleAccordion } from '../team/TeamRuleAccordion'
import { TeamRuleForm } from '../team/TeamRuleForm'

export function TeamRulesScreen() {
  const { teamCode, teamName, teamDescription, teamRules } = useAppState()
  const dispatch = useAppDispatch()
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [creating, setCreating] = useState(false)
  const [copied, setCopied] = useState(false)
  // MainScreen의 전역 error/ErrorBanner는 이 화면(팀-코드 화면 전환 시 언마운트되는 별도
  // Screen)에서는 렌더링되지 않으므로 재사용하지 않는다 — 이 화면 안에서만 뜨는 로컬 에러.
  const [loadError, setLoadError] = useState<string | null>(null)
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!teamCode) return
    api
      .listTeamRules(teamCode)
      .then((rules) => dispatch({ type: 'TEAM_RULES_LOADED', rules }))
      .catch(() => setLoadError('팀 규칙 목록을 불러오지 못했습니다.'))
  }, [teamCode, dispatch])

  useEffect(() => () => {
    if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current)
  }, [])

  const goToMain = () => dispatch({ type: 'NAVIGATE', screen: 'main' })

  const copyTeamCode = async () => {
    if (!teamCode) return
    try {
      await navigator.clipboard.writeText(teamCode)
      setCopied(true)
      copiedTimeoutRef.current = setTimeout(() => setCopied(false), 1500)
    } catch {
      // 클립보드 권한이 없는 환경에서도 화면의 코드로 수동 복사는 여전히 가능하니 조용히 무시.
    }
  }

  const createRule = async (input: TeamRuleInput) => {
    if (!teamCode) return
    setCreating(true)
    try {
      const rule = await api.createTeamRule(teamCode, input)
      dispatch({ type: 'TEAM_RULE_ADDED', rule })
      setShowCreateForm(false)
    } catch {
      setLoadError('팀 규칙 추가에 실패했습니다.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="screen team-rules-screen">
      <div className="screen-scroll">
        <h1 className="panel-title">똑독</h1>
        <hr className="panel-divider" />

        <div className="team-rules-header">
          <h2 className="team-rules-heading">👥 {teamName}</h2>
          {teamCode && (
            <div className="team-code-row">
              <p className="team-code-display">
                팀 코드 <span className="team-code-value">{teamCode}</span>
              </p>
              <button type="button" className="team-code-copy-button" onClick={() => void copyTeamCode()} aria-label="팀 코드 복사">
                {copied ? '✓' : '📋'}
              </button>
            </div>
          )}
          {teamDescription && <p className="hint">{teamDescription}</p>}
        </div>

        {loadError && <ErrorBanner message={loadError} />}

        {teamCode && <TeamRuleAccordion rules={teamRules} teamCode={teamCode} onError={setLoadError} />}

        {showCreateForm ? (
          <TeamRuleForm saving={creating} onCancel={() => setShowCreateForm(false)} onSave={(input) => void createRule(input)} />
        ) : (
          <button type="button" className="btn-link team-rule-add-link" onClick={() => setShowCreateForm(true)}>
            + 팀 규칙 추가
          </button>
        )}
      </div>

      <div className="screen-footer">
        <button type="button" className="screen-back-link" onClick={goToMain}>
          ← 메인으로
        </button>
      </div>
    </div>
  )
}
