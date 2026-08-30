import { useState } from 'react'
import type { RuleExamplePair, TeamRuleExamples, TeamRuleInput, TeamRuleResponse } from '../../api/types'
import { isTeamRuleInputValid } from '../../state/teamRuleValidation'
import { Button } from '../common/Button'

interface TeamRuleFormProps {
  initial?: TeamRuleResponse
  onSave: (input: TeamRuleInput) => void
  onCancel: () => void
  saving?: boolean
}

const EMPTY_EXAMPLES: TeamRuleExamples = {
  error1: { error: '', correction: '' },
  error2: { error: '', correction: '' },
  exception: '',
}

export function TeamRuleForm({ initial, onSave, onCancel, saving = false }: TeamRuleFormProps) {
  const [ruleName, setRuleName] = useState(initial?.rule_name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [exceptionText, setExceptionText] = useState(initial?.exception_text ?? '')
  const [examples, setExamples] = useState<TeamRuleExamples>(initial?.examples ?? EMPTY_EXAMPLES)
  const [enabled] = useState(initial?.enabled ?? true)

  const updatePair = (slot: 'error1' | 'error2', field: keyof RuleExamplePair, value: string) => {
    setExamples((prev) => ({ ...prev, [slot]: { ...prev[slot], [field]: value } }))
  }

  const input: TeamRuleInput = { rule_name: ruleName, description, exception_text: exceptionText || null, examples, enabled }
  const canSave = isTeamRuleInputValid(input)

  return (
    <div className="team-rule-form">
      <div className="team-rule-form-field">
        <label className="team-rule-form-label" htmlFor="team-rule-name">
          규칙명 *
        </label>
        <input
          id="team-rule-name"
          className="team-code-input"
          value={ruleName}
          onChange={(e) => setRuleName(e.target.value)}
          placeholder="예: 정책 문서와 기획서의 정합성"
        />
      </div>

      <div className="team-rule-form-field">
        <label className="team-rule-form-label" htmlFor="team-rule-description">
          규칙 설명 *
        </label>
        <textarea
          id="team-rule-description"
          className="issue-edit-textarea"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="예: 기획서의 정책 관련 내용이 기준 정책 문서와 일치하는지 검토합니다."
        />
      </div>

      <div className="team-rule-form-field">
        <label className="team-rule-form-label" htmlFor="team-rule-exception">
          예외 상황
        </label>
        <textarea
          id="team-rule-exception"
          className="issue-edit-textarea"
          value={exceptionText}
          onChange={(e) => setExceptionText(e.target.value)}
          rows={2}
          placeholder="예: 정책 변경이 확정되었으나 아직 정책 문서에 반영되지 않은 경우에는 오류로 판단하지 않습니다."
        />
      </div>

      <div className="team-rule-form-field">
        <span className="team-rule-form-label">규칙 사례</span>

        {(['error1', 'error2'] as const).map((slot, index) => (
          <div key={slot} className="team-rule-example-block">
            <p className="team-rule-example-block-title">{`${index + 1} 오류 사례`}</p>
            <label className="team-rule-example-label" htmlFor={`${slot}-error`}>
              오류
            </label>
            <textarea
              id={`${slot}-error`}
              className="issue-edit-textarea"
              value={examples[slot].error}
              onChange={(e) => updatePair(slot, 'error', e.target.value)}
              rows={2}
              placeholder="이 규칙에 해당하는 잘못된 사례"
            />
            <label className="team-rule-example-label" htmlFor={`${slot}-correction`}>
              수정
            </label>
            <textarea
              id={`${slot}-correction`}
              className="issue-edit-textarea"
              value={examples[slot].correction}
              onChange={(e) => updatePair(slot, 'correction', e.target.value)}
              rows={2}
              placeholder="위 오류를 올바르게 수정한 사례"
            />
            {examples[slot].error && !examples[slot].correction && (
              <p className="hint">오류 사례의 수정 방향도 함께 입력하면 AI의 판단 및 수정 방향 이해에 도움이 됩니다.</p>
            )}
          </div>
        ))}

        <div className="team-rule-example-block">
          <p className="team-rule-example-block-title">3 예외 사례</p>
          <label className="team-rule-example-label" htmlFor="exception-example">
            예외
          </label>
          <textarea
            id="exception-example"
            className="issue-edit-textarea"
            value={examples.exception}
            onChange={(e) => setExamples((prev) => ({ ...prev, exception: e.target.value }))}
            rows={2}
            placeholder="오류처럼 보이지만 이 규칙에 해당하지 않는 사례"
          />
        </div>
      </div>

      <div className="team-rule-form-actions">
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          취소
        </Button>
        <Button onClick={() => onSave(input)} disabled={!canSave || saving}>
          저장
        </Button>
      </div>
    </div>
  )
}
