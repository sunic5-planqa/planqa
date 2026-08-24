import { useState } from 'react'
import { api } from '../../api/client'
import type { TeamRuleInput, TeamRuleResponse } from '../../api/types'
import { useAppDispatch } from '../../state/hooks'
import { ConfirmDialog } from '../common/ConfirmDialog'
import { TeamRuleForm } from './TeamRuleForm'

export function TeamRuleAccordion({ rules, teamCode }: { rules: TeamRuleResponse[]; teamCode: string }) {
  const dispatch = useAppDispatch()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const saveEdit = async (rule: TeamRuleResponse, input: TeamRuleInput) => {
    setSaving(true)
    try {
      const updated = await api.updateTeamRule(teamCode, rule.id, input)
      dispatch({ type: 'TEAM_RULE_UPDATED', rule: updated })
      setEditingId(null)
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async (ruleId: string) => {
    await api.deleteTeamRule(teamCode, ruleId)
    dispatch({ type: 'TEAM_RULE_DELETED', ruleId })
    setConfirmDeleteId(null)
  }

  return (
    <div className="team-rule-accordion">
      {rules.map((rule) => {
        // 연필을 누르면 카드가 접혀 있어도(=expanded에 없어도) 바로 수정 폼이 보여야 한다 —
        // editingId만으로 열림 상태를 판단하고, expanded는 읽기 전용 펼침에만 관여시킨다.
        const isOpen = expanded.has(rule.id) || editingId === rule.id
        return (
        <div key={rule.id} className="team-rule-card">
          <div className="team-rule-card-row">
            <button type="button" className="team-rule-card-toggle" onClick={() => toggleExpanded(rule.id)}>
              {rule.rule_name} {isOpen ? '˄' : '˅'}
            </button>
            <div className="team-rule-card-icons">
              <button type="button" className="team-rule-icon-button" onClick={() => setEditingId(rule.id)} aria-label="수정">
                ✎
              </button>
              <button
                type="button"
                className="team-rule-icon-button"
                onClick={() => setConfirmDeleteId(rule.id)}
                aria-label="삭제"
              >
                🗑
              </button>
            </div>
          </div>

          {isOpen &&
            (editingId === rule.id ? (
              <TeamRuleForm
                initial={rule}
                saving={saving}
                onCancel={() => setEditingId(null)}
                onSave={(input) => void saveEdit(rule, input)}
              />
            ) : (
              <div className="team-rule-card-body">
                <div className="team-rule-card-block">
                  <span className="team-rule-card-label">규칙 설명</span>
                  <p className="team-rule-card-value">{rule.description}</p>
                </div>
                {rule.exception_text && (
                  <div className="team-rule-card-block">
                    <span className="team-rule-card-label">예외 상황</span>
                    <p className="team-rule-card-value">{rule.exception_text}</p>
                  </div>
                )}
                <div className="team-rule-card-block">
                  <span className="team-rule-card-label">규칙 사례</span>
                  {rule.examples.error1.error && (
                    <div className="team-rule-card-example">
                      <p className="team-rule-card-example-wrong">① 오류: {rule.examples.error1.error}</p>
                      <p className="team-rule-card-example-fixed">수정: {rule.examples.error1.correction}</p>
                    </div>
                  )}
                  {rule.examples.error2.error && (
                    <div className="team-rule-card-example">
                      <p className="team-rule-card-example-wrong">② 오류: {rule.examples.error2.error}</p>
                      <p className="team-rule-card-example-fixed">수정: {rule.examples.error2.correction}</p>
                    </div>
                  )}
                  {rule.examples.exception && (
                    <div className="team-rule-card-example">
                      <p className="team-rule-card-example-wrong">③ 예외: {rule.examples.exception}</p>
                    </div>
                  )}
                </div>
              </div>
            ))}

          {confirmDeleteId === rule.id && (
            <ConfirmDialog
              message="팀 규칙을 삭제하시겠습니까? 삭제한 규칙은 문서 검토에서 더 이상 적용되지 않습니다."
              onCancel={() => setConfirmDeleteId(null)}
              onConfirm={() => void confirmDelete(rule.id)}
            />
          )}
        </div>
        )
      })}
    </div>
  )
}
