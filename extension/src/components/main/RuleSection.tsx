import { useState } from 'react'
import { api } from '../../api/client'
import { ApiError } from '../../api/errors'
import { useAppDispatch, useAppState } from '../../state/hooks'
import { Button } from '../common/Button'

// rulebook_v1.0.md의 8개 카테고리는 저장소에 커밋된 정적 파일이라 사용자/문서마다 달라지지
// 않는다 — 예전엔 라벨만 /rulebook/categories로 매번 새로 받아왔는데, 그 응답이 올 때까지
// "적용된 규칙: 0개"로 보였다가(백엔드 콜드스타트 땐 수십 초까지) 갑자기 8개로 바뀌는 게
// 실사용 혼란으로 이어졌다(2026-09-05). 한 줄 설명은 이미 프론트엔드에 고정돼 있었으니(Figma
// 목업 문구, 백엔드에 없음) 라벨도 같이 고정해서 백엔드 호출 자체를 없앤다 — rulebook_v1.0.md가
// 바뀌면 이 배열도 같이 고쳐야 한다.
const BASE_RULE_CATEGORIES: { category: string; label: string; description: string }[] = [
  { category: 'LG', label: '논리비약', description: '문서 내용 사이의 연결이 비약하는 경우' },
  { category: 'LF', label: '논리흐름', description: '내용의 전개 순서나 연결성이 자연스럽지 않은 경우' },
  { category: 'TC', label: '용어 및 단어의 일관성', description: '동일한 개념을 서로 다른 용어나 표기로 사용하는 경우' },
  { category: 'TM', label: '용어 오용', description: '용어를 의미와 다르게 사용하거나 부적절하게 쓰는 경우' },
  { category: 'AE', label: '모호한 표현', description: '의미가 불명확하거나 여러 해석이 가능한 표현인 경우' },
  { category: 'MI', label: '정보 누락', description: '목적 달성에 필요한 정보가 존재하지 않는 경우' },
  { category: 'RD', label: '불필요한 중복', description: '동일하거나 유사한 내용을 반복 전달하는 경우' },
  { category: 'GA', label: '상위 목표와 세부 내용의 정합성', description: '상위 목표와 하위 내용이 어긋나는 경우' },
]

export function RuleSection() {
  const { teamCode, teamName, teamRules } = useAppState()
  const dispatch = useAppDispatch()

  const [teamCodeInput, setTeamCodeInput] = useState('')
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)

  const [showCreateTeamForm, setShowCreateTeamForm] = useState(false)
  const [newTeamName, setNewTeamName] = useState('')
  const [newTeamDescription, setNewTeamDescription] = useState('')
  const [creating, setCreating] = useState(false)

  const [togglingId, setTogglingId] = useState<string | null>(null)

  const connectTeam = async () => {
    if (!teamCodeInput.trim()) return
    setConnecting(true)
    setLookupError(null)
    try {
      const team = await api.getTeam(teamCodeInput.trim())
      // getTeam 성공 시점에 바로 화면이 "연결됨" 카드로 전환되므로(teamCode !== null), 아래
      // listTeamRules가 실패해도 lookupError는 더 이상 보이는 브랜치가 아니다 — 화면 어디서든
      // 항상 렌더링되는 전역 error/ErrorBanner(MainScreen)로 따로 알린다.
      dispatch({ type: 'TEAM_CONNECTED', team })
      try {
        const rules = await api.listTeamRules(team.team_code)
        dispatch({ type: 'TEAM_RULES_LOADED', rules })
      } catch {
        dispatch({ type: 'SET_ERROR', error: '팀 규칙 목록을 불러오지 못했습니다.' })
      }
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
    } catch {
      dispatch({ type: 'SET_ERROR', error: '팀 생성에 실패했습니다.' })
    } finally {
      setCreating(false)
    }
  }

  const toggleRuleEnabled = async (ruleId: string, enabled: boolean) => {
    if (!teamCode) return
    setTogglingId(ruleId)
    try {
      // A dedicated enabled-only endpoint (not updateTeamRule's full-replace PATCH) so this
      // can never resend a stale copy of rule_name/description/exception_text/examples over
      // whatever another editor just saved for this same rule.
      const updated = await api.setTeamRuleEnabled(teamCode, ruleId, enabled)
      dispatch({ type: 'TEAM_RULE_UPDATED', rule: updated })
    } catch {
      dispatch({ type: 'SET_ERROR', error: '규칙 적용 여부 변경에 실패했습니다.' })
    } finally {
      setTogglingId(null)
    }
  }

  const ruleCount = BASE_RULE_CATEGORIES.length + teamRules.filter((rule) => rule.enabled).length

  return (
    <div className="rule-section">
      <h2 className="rule-heading">
        Rule <span className="rule-count">(적용된 규칙: {ruleCount}개)</span>
      </h2>

      <div className="rule-card">
        <p className="rule-card-header">✅ 기본 규칙</p>
        <ul className="rule-base-list">
          {BASE_RULE_CATEGORIES.map((category, index) => (
            <li key={category.category} className="rule-base-item">
              <span className="rule-number-badge">{index + 1}</span>
              <div className="rule-base-item-text">
                <p className="rule-base-item-name">{category.label}</p>
                <p className="rule-base-item-description">{category.description}</p>
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
