import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import { ApiError } from '../../api/errors'
import { useAppDispatch, useAppState } from '../../state/hooks'
import { Button } from '../common/Button'

// rulebook_v1.0.md의 카테고리 헤더는 이름만 있고 한 줄 설명이 없다 — Figma 목업 문구를 그대로
// 프론트엔드에 고정 데이터로 둔다(백엔드는 안 건드림, 사용자 확인 완료). 패널 폭이 좁아 한 줄에
// 안 들어가는 경우가 있어 원문 의미를 유지하면서 짧게 축약했다(CSS 말줄임 대신 문구 자체 축약).
const BASE_RULE_DESCRIPTIONS: Record<string, string> = {
  LG: '문서 내용 사이의 연결이 비약하는 경우',
  LF: '내용의 전개 순서나 연결성이 자연스럽지 않은 경우',
  TC: '동일한 개념을 서로 다른 용어나 표기로 사용하는 경우',
  TM: '용어를 의미와 다르게 사용하거나 부적절하게 쓰는 경우',
  AE: '의미가 불명확하거나 여러 해석이 가능한 표현인 경우',
  MI: '목적 달성에 필요한 정보가 존재하지 않는 경우',
  RD: '동일하거나 유사한 내용을 반복 전달하는 경우',
  GA: '상위 목표와 하위 내용이 어긋나는 경우',
}

export function RuleSection() {
  const { ruleCategories, teamCode, teamName, teamRules } = useAppState()
  const dispatch = useAppDispatch()

  const [teamCodeInput, setTeamCodeInput] = useState('')
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)

  const [showCreateTeamForm, setShowCreateTeamForm] = useState(false)
  const [newTeamName, setNewTeamName] = useState('')
  const [newTeamDescription, setNewTeamDescription] = useState('')
  const [creating, setCreating] = useState(false)

  const [togglingId, setTogglingId] = useState<string | null>(null)

  useEffect(() => {
    api
      .getRulebookCategories()
      .then((categories) => dispatch({ type: 'RULE_CATEGORIES_LOADED', categories }))
      .catch(() => {
        // 기본 규칙 목록은 부가 정보라 실패해도 화면 자체는 그대로 동작해야 한다.
      })
  }, [dispatch])

  const connectTeam = async () => {
    if (!teamCodeInput.trim()) return
    setConnecting(true)
    setLookupError(null)
    try {
      const team = await api.getTeam(teamCodeInput.trim())
      dispatch({ type: 'TEAM_CONNECTED', team })
      const rules = await api.listTeamRules(team.team_code)
      dispatch({ type: 'TEAM_RULES_LOADED', rules })
    } catch (err) {
      setLookupError(err instanceof ApiError && err.status === 404 ? '팀 코드를 찾을 수 없습니다.' : '팀 조회에 실패했습니다.')
    } finally {
      setConnecting(false)
    }
  }

  const createTeam = async () => {
    if (!newTeamName.trim()) return
    setCreating(true)
    try {
      const team = await api.createTeam({ team_name: newTeamName.trim(), description: newTeamDescription.trim() })
      dispatch({ type: 'TEAM_CONNECTED', team })
      dispatch({ type: 'TEAM_RULES_LOADED', rules: [] })
      setShowCreateTeamForm(false)
      // 방금 생성된 팀 코드를 확인할 곳이 관리 페이지뿐이라, 만들자마자 그리로 이동시킨다.
      dispatch({ type: 'NAVIGATE', screen: 'team-rules' })
    } finally {
      setCreating(false)
    }
  }

  const toggleRuleEnabled = async (ruleId: string, enabled: boolean) => {
    if (!teamCode) return
    const rule = teamRules.find((r) => r.id === ruleId)
    if (!rule) return
    setTogglingId(ruleId)
    try {
      const updated = await api.updateTeamRule(teamCode, ruleId, {
        rule_name: rule.rule_name,
        description: rule.description,
        exception_text: rule.exception_text,
        examples: rule.examples,
        enabled,
      })
      dispatch({ type: 'TEAM_RULE_UPDATED', rule: updated })
    } finally {
      setTogglingId(null)
    }
  }

  const ruleCount = ruleCategories.length + teamRules.filter((rule) => rule.enabled).length

  return (
    <div className="rule-section">
      <h2 className="rule-heading">
        Rule <span className="rule-count">(적용된 규칙: {ruleCount}개)</span>
      </h2>

      <div className="rule-card">
        <p className="rule-card-header">✅ 기본 규칙</p>
        <ul className="rule-base-list">
          {ruleCategories.map((category, index) => (
            <li key={category.category} className="rule-base-item">
              <span className="rule-number-badge">{index + 1}</span>
              <div className="rule-base-item-text">
                <p className="rule-base-item-name">{category.label}</p>
                <p className="rule-base-item-description">{BASE_RULE_DESCRIPTIONS[category.category] ?? ''}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {teamCode === null ? (
        <div className="team-connect-row">
          <div className="team-connect-input-row">
            <input
              className="team-code-input"
              value={teamCodeInput}
              onChange={(e) => setTeamCodeInput(e.target.value)}
              placeholder="팀 코드 입력"
            />
            <Button variant="secondary" onClick={() => void connectTeam()} disabled={connecting}>
              확인
            </Button>
          </div>
          {lookupError && <p className="hint team-connect-error">{lookupError}</p>}

          {showCreateTeamForm ? (
            <div className="create-team-form">
              <input
                className="team-code-input"
                value={newTeamName}
                onChange={(e) => setNewTeamName(e.target.value)}
                placeholder="팀명"
              />
              <input
                className="team-code-input"
                value={newTeamDescription}
                onChange={(e) => setNewTeamDescription(e.target.value)}
                placeholder="짧은 설명"
              />
              <div className="create-team-form-actions">
                <button type="button" className="btn-link" onClick={() => setShowCreateTeamForm(false)}>
                  취소
                </button>
                <Button onClick={() => void createTeam()} disabled={!newTeamName.trim() || creating}>
                  만들기
                </Button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn-link team-create-link" onClick={() => setShowCreateTeamForm(true)}>
              팀 만들기
            </button>
          )}
        </div>
      ) : (
        <div className="rule-card">
          <div className="rule-card-header-row">
            <p className="rule-card-header">👥 팀 규칙 · {teamName}</p>
            <button
              type="button"
              className="rule-card-gear-button"
              onClick={() => dispatch({ type: 'NAVIGATE', screen: 'team-rules' })}
              aria-label="팀 규칙 관리"
            >
              ⚙
            </button>
          </div>

          {teamRules.length === 0 ? (
            <p className="hint">등록된 팀 규칙이 없습니다.</p>
          ) : (
            <ul className="rule-base-list">
              {teamRules.map((rule) => (
                <li key={rule.id} className="rule-base-item team-rule-row">
                  <input
                    type="checkbox"
                    className="team-rule-checkbox"
                    checked={rule.enabled}
                    disabled={togglingId === rule.id}
                    onChange={(e) => void toggleRuleEnabled(rule.id, e.target.checked)}
                  />
                  <div className="rule-base-item-text">
                    <p className="rule-base-item-name">{rule.rule_name}</p>
                    <p className="rule-base-item-description team-rule-row-description">{rule.description}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
