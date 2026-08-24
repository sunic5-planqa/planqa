import { useEffect, useRef, useState } from 'react'
import { api } from '../../api/client'
import type { TeamRuleInput } from '../../api/types'
import { useAppDispatch, useAppState } from '../../state/hooks'
import { TeamRuleAccordion } from '../team/TeamRuleAccordion'
import { TeamRuleForm } from '../team/TeamRuleForm'

export function TeamRulesScreen() {
  const { teamCode, teamName, teamDescription, teamRules } = useAppState()
  const dispatch = useAppDispatch()
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [creating, setCreating] = useState(false)
  const [copied, setCopied] = useState(false)
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!teamCode) return
    api.listTeamRules(teamCode).then((rules) => dispatch({ type: 'TEAM_RULES_LOADED', rules }))
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

        {teamCode && <TeamRuleAccordion rules={teamRules} teamCode={teamCode} />}

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
