import { useState } from 'react'
import { api } from '../../api/client'
import { NotImplementedError } from '../../api/errors'
import type {
  ApplyIssueEditRequest,
  ApplyIssueEditResponse,
  FetchPageMarkdownRequest,
  FetchPageMarkdownResponse,
  GetActiveDuplicatePageRequest,
  GetActiveDuplicatePageResponse,
} from '../../content/messages'
import { OverviewPanel } from '../issues/OverviewPanel'
import { isIssueLikelyResolved } from '../../state/editValidation'
import { useAppDispatch, useAppState } from '../../state/hooks'
import { Button } from '../common/Button'
import { QuoteHighlightedText } from '../common/QuoteHighlightedText'
import { formatLocationLabel } from '../../utils/locationLabel'

const RESOLVED_ACTIONS = new Set(['apply', 'edit'])

export function IssueListScreen() {
  const { issues, currentIssueIndex, issueEdits, editingIssueId, jobId, confluenceMarkdown } = useAppState()
  const dispatch = useAppDispatch()

  const resolvedCount = issues.filter((i) => RESOLVED_ACTIONS.has(issueEdits[i.id]?.action ?? '')).length
  const remainingCount = issues.length - resolvedCount

  const [finishingQA, setFinishingQA] = useState(false)

  // 넘버링 검증은 AI QA와 별개 영역이라 여기서 새로 조회한다. AI QA 리뷰 중 적용한 수정은 원본이
  // 아니라 별도 "복제본" 페이지에 쌓이므로(원본은 절대 안 건드림), 복제본이 있으면 그 최신 내용을
  // 가져오고, 아직 복제본이 없으면(= 아무 수정도 적용 안 했으면) 원본 페이지를 다시 가져온다 — 이때
  // AppState의 기존 confluenceMarkdown을 그대로 재사용하지 않는다: 그건 AI QA용으로 추출된 것이라
  // 본문 h1이 h2와 같은 레벨로 뭉개져 있어서(review_agent 청크 분할용 — confluenceParser.ts 참고),
  // 대주제를 Heading 1로 쓴 실제 문서에서 대주제/소주제가 전부 한 그룹으로 섞여 오탐이 났었다(실사용
  // 확인된 버그). preserveHeadingLevels:true로 다시 받아 h1~h6 원래 레벨을 그대로 보존한다. 오류가
  // 없거나 조회 자체가 실패하면(유사도체크와 동일한 "안전장치일 뿐 필수 게이트 아님" 철학) 지금까지
  // 처럼 곧장 검토 종료 화면으로 보내고, 오류가 있을 때만 넘버링 확인 화면으로 분기한다.
  const finishQA = async () => {
    if (!jobId) {
      dispatch({ type: 'NAVIGATE', screen: 'history' })
      return
    }
    setFinishingQA(true)
    try {
      let freshText = confluenceMarkdown
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab.id) {
        const dupResponse = await chrome.tabs.sendMessage<GetActiveDuplicatePageRequest, GetActiveDuplicatePageResponse>(
          tab.id,
          { type: 'GET_ACTIVE_DUPLICATE_PAGE' },
        )
        const targetPageId = dupResponse.ok ? (dupResponse.pageId ?? dupResponse.originalPageId) : null
        if (targetPageId) {
          const pageResponse = await chrome.tabs.sendMessage<FetchPageMarkdownRequest, FetchPageMarkdownResponse>(
            tab.id,
            { type: 'FETCH_PAGE_MARKDOWN', pageId: targetPageId, preserveHeadingLevels: true },
          )
          if (pageResponse.ok) freshText = pageResponse.markdown
        }
      }

      if (!freshText) {
        dispatch({ type: 'NAVIGATE', screen: 'history' })
        return
      }

      const numberingIssues = await api.getNumberingIssues(jobId, freshText)
      if (numberingIssues.length === 0) {
        dispatch({ type: 'NAVIGATE', screen: 'history' })
      } else {
        dispatch({ type: 'NUMBERING_ISSUES_LOADED', issues: numberingIssues })
      }
    } catch {
      dispatch({ type: 'NAVIGATE', screen: 'history' })
    } finally {
      setFinishingQA(false)
    }
  }

  const issue = issues[currentIssueIndex]
  // insert_range(MI=정보 누락)는 "원문을 AI 제안으로 교체"할 대상 자체가 없다 — input_text가
  // 비어있거나(원래 없어야 할 텍스트라서), 문서 쪽 하이라이트는 최후 수단으로 섹션 제목을 감싸고
  // 있을 뿐이다(issueOverlay.ts의 wrapIssueByLocationHeading). 여길 그대로 "수정 저장" 가능하게
  // 두면 섹션 제목이 "이 정보를 추가하세요" 같은 제안 문구로 통째로 덮어써지는 사고가 난다.
  const isInsertRangeIssue = issue?.frame_type === 'insert_range'
  const isEditing = !isInsertRangeIssue && issue !== undefined && editingIssueId === issue.id
  // LG/LF/GA는 두 위치 간 관계 오류라 두 번째 위치(related_original_text)도 있으면 독립적으로
  // 편집·저장할 수 있게 한다 — 없으면(모델이 못 찾은 경우) 지금까지처럼 첫 번째 위치만 편집 가능.
  const isRelationalIssue = issue?.frame_type === 'range' && !!issue.related_original_text

  // 렌더 중에 파생시키는 초안 — draft.issueId/target이 지금 편집 중인 것과 다르면(편집을 처음
  // 시작했거나 "수정 복구"로 초기화한 경우) 기존 제안/원문으로 폴백한다. useEffect로 props→state를
  // 동기화하지 않아도 돼서 더 단순하고, 렌더 중 setState를 유발하지 않는다.
  const [editingTarget, setEditingTarget] = useState<'primary' | 'related'>('primary')
  const [draft, setDraft] = useState<{ issueId: string; target: 'primary' | 'related'; text: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [warningAcknowledged, setWarningAcknowledged] = useState(false)
  const [similarityWarning, setSimilarityWarning] = useState<string | null>(null)
  const [checkingSimilarity, setCheckingSimilarity] = useState(false)

  if (!issue) {
    return (
      <div className="screen issue-list-screen">
        <p>발견된 이슈가 없습니다.</p>
        <Button onClick={() => void finishQA()} disabled={finishingQA}>
          다음
        </Button>
      </div>
    )
  }

  const primaryResolved = issueEdits[issue.id]?.editedText !== undefined
  const relatedResolved = issueEdits[issue.id]?.relatedEditedText !== undefined

  const suggestion = issueEdits[issue.id]?.editedText ?? issue.suggestion
  // 관련 위치엔 AI가 준 "제안" 자체가 없다(모델이 두 번째 위치의 원문만 인용해줄 뿐) — 그래서
  // 사용자가 그 원문에서부터 직접 고쳐나가는 게 시작점이다.
  const relatedSuggestion = issueEdits[issue.id]?.relatedEditedText ?? issue.related_original_text ?? ''

  const isEditingPrimary = isEditing && editingTarget === 'primary'
  const isEditingRelated = isEditing && editingTarget === 'related'
  const draftText = draft?.issueId === issue.id && draft.target === 'primary' ? draft.text : suggestion
  const relatedDraftText = draft?.issueId === issue.id && draft.target === 'related' ? draft.text : relatedSuggestion
  const activeOldText = editingTarget === 'related' ? (issue.related_original_text ?? '') : issue.input_text
  const activeDraftText = editingTarget === 'related' ? relatedDraftText : draftText
  const issueLikelyResolved = isEditing ? isIssueLikelyResolved(activeOldText, activeDraftText) : true

  const startEdit = (target: 'primary' | 'related') => {
    setEditingTarget(target)
    setSaveError(null)
    setWarningAcknowledged(false)
    setSimilarityWarning(null)
    dispatch({ type: 'START_EDIT_ISSUE', issueId: issue.id })
  }

  const cancelEdit = () => {
    setDraft(null)
    setSaveError(null)
    setSimilarityWarning(null)
    dispatch({ type: 'STOP_EDIT_ISSUE' })
  }

  const saveEdit = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab.id) {
        setSaveError('컨플루언스 탭을 찾을 수 없습니다.')
        return
      }

      const response = await chrome.tabs.sendMessage<ApplyIssueEditRequest, ApplyIssueEditResponse>(tab.id, {
        type: 'APPLY_ISSUE_EDIT',
        issueId: issue.id,
        oldText: activeOldText,
        newText: activeDraftText,
      })

      if (!response.ok) {
        setSaveError(response.error)
        return
      }

      dispatch({
        type: 'STAGE_ISSUE_EDIT',
        issueId: issue.id,
        action: 'edit',
        target: editingTarget,
        editedText: activeDraftText,
      })
      dispatch({ type: 'STOP_EDIT_ISSUE' })
      setDraft(null)
      // 저장 성공 시 다음 이슈로 자동 이동 — 마지막 이슈였으면 NAVIGATE_ISSUE가 범위를 clamp해서
      // 그냥 제자리에 머문다(appReducer.ts), 별도 경계 처리 필요 없음. 관계형 이슈에서 한쪽만
      // 고치고 다른 쪽도 마저 고치고 싶으면 "이전"으로 돌아와 나머지를 편집하면 된다.
      dispatch({ type: 'NAVIGATE_ISSUE', direction: 'next' })

      try {
        await api.updateIssue(issue.id, { action: 'edit', edited_text: activeDraftText })
      } catch (err) {
        if (!(err instanceof NotImplementedError)) {
          dispatch({ type: 'SET_ERROR', error: err instanceof Error ? err.message : String(err) })
        }
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  // 처음 누르면: (1) 원래 문제 문구가 아직 남아있는지(로컬, 즉시) → (2) 이 수정이 검증기준을
  // 실질적으로 해결하는지(백엔드 LLM 판단, /issues/similarity-check) 순서로 확인한다. 둘 중
  // 하나라도 걸리면 저장하지 않고 경고만 띄운 채 리턴 — 사용자가 "수정 저장"을 한 번 더 눌러야
  // (warningAcknowledged) 그대로 반영된다. 백엔드 호출이 실패해도(네트워크 문제 등) 저장 자체를
  // 막지는 않는다 — 이 검사는 안전장치일 뿐 필수 게이트가 아니기 때문. 관련 위치 편집은 비교
  // 기준이 될 "AI 제안"이 애초에 없어서(원문에서 바로 고치는 것 자체가 목적) 이 검사를 건너뛴다.
  const handleSaveClick = async () => {
    if (warningAcknowledged) {
      void saveEdit()
      return
    }

    if (!issueLikelyResolved) {
      setSimilarityWarning(null)
      setWarningAcknowledged(true)
      return
    }

    if (editingTarget === 'related') {
      void saveEdit()
      return
    }

    setCheckingSimilarity(true)
    try {
      const result = await api.checkEditSimilarity({
        originalText: issue.input_text,
        criteria: issue.criteria,
        reason: issue.reason,
        suggestion: issue.suggestion,
        editedText: activeDraftText,
      })
      if (!result.addresses_issue) {
        setSimilarityWarning(result.reason || 'AI 제안과 다소 달라요.')
        setWarningAcknowledged(true)
        return
      }
    } catch {
      // 검사 실패는 무시하고 저장은 계속 진행한다.
    } finally {
      setCheckingSimilarity(false)
    }

    void saveEdit()
  }

  return (
    <div className="screen issue-list-screen">
      <div className="screen-scroll">
        <h1 className="panel-title">똑독</h1>
        <hr className="panel-divider" />

        <OverviewPanel issues={issues} currentIssueId={issue.id} />

        {isEditing ? (
          <p className="issue-editing-status">
            <span className="issue-editing-dot">•</span> 수정 진행 중...
          </p>
        ) : (
          <p className="issue-error-count">
            문서 오류 <strong>{remainingCount}</strong>개
          </p>
        )}

        <div className="issue-detail-card">
          <p className="issue-location">
            {formatLocationLabel(issue.location, issue.location_number)}
            {issue.related_location && <> ↔ {issue.related_location}</>}
          </p>

          <div className="issue-detail-block">
            <span className="issue-detail-label">입력내용</span>
            <p className="issue-detail-value">{issue.input_text}</p>
          </div>

          <div className={`issue-suggestion-box ${isEditingPrimary ? 'issue-suggestion-box-editing' : ''}`.trim()}>
            <div className="issue-suggestion-row">
              <span className="issue-detail-label">수정제안</span>
              {!isEditing &&
                !isInsertRangeIssue &&
                (primaryResolved ? (
                  <span className="resolved-badge">✓ 수정완료</span>
                ) : (
                  <button type="button" className="issue-fix-link" onClick={() => startEdit('primary')}>
                    <span className="issue-fix-link-text">오류 수정하기</span>
                    <svg className="issue-fix-link-icon" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                      <circle cx="6" cy="6" r="5.25" stroke="currentColor" strokeWidth="1" />
                      <path
                        d="M4.4 7.6 7.3 4.7a.5.5 0 0 1 .7 0l.3.3a.5.5 0 0 1 0 .7L5.4 8.6l-1.2.3.2-1.3Z"
                        fill="currentColor"
                      />
                    </svg>
                  </button>
                ))}
            </div>
            {isEditingPrimary ? (
              <textarea
                className="issue-edit-textarea"
                value={draftText}
                onChange={(e) => {
                  setDraft({ issueId: issue.id, target: 'primary', text: e.target.value })
                  setWarningAcknowledged(false)
                  setSimilarityWarning(null)
                }}
                rows={4}
                autoFocus
              />
            ) : (
              <p className="issue-suggestion-text">
                <QuoteHighlightedText text={suggestion} quoteClassName="gradient-quote" />
              </p>
            )}
            {isInsertRangeIssue && (
              <p className="issue-suggestion-hint">
                문서에 없는 내용을 추가하라는 안내라, 자동으로 반영할 수 없어요. 문서에서 표시된 위치를 직접 확인하고
                반영해주세요.
              </p>
            )}
          </div>

          {isRelationalIssue && (
            <div className={`issue-suggestion-box ${isEditingRelated ? 'issue-suggestion-box-editing' : ''}`.trim()}>
              <div className="issue-suggestion-row">
                <span className="issue-detail-label">관련 위치 원문</span>
                {!isEditing &&
                  (relatedResolved ? (
                    <span className="resolved-badge">✓ 수정완료</span>
                  ) : (
                    <button type="button" className="issue-fix-link" onClick={() => startEdit('related')}>
                      <span className="issue-fix-link-text">오류 수정하기</span>
                      <svg className="issue-fix-link-icon" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                        <circle cx="6" cy="6" r="5.25" stroke="currentColor" strokeWidth="1" />
                        <path
                          d="M4.4 7.6 7.3 4.7a.5.5 0 0 1 .7 0l.3.3a.5.5 0 0 1 0 .7L5.4 8.6l-1.2.3.2-1.3Z"
                          fill="currentColor"
                        />
                      </svg>
                    </button>
                  ))}
              </div>
              {isEditingRelated ? (
                <textarea
                  className="issue-edit-textarea"
                  value={relatedDraftText}
                  onChange={(e) => {
                    setDraft({ issueId: issue.id, target: 'related', text: e.target.value })
                    setWarningAcknowledged(false)
                    setSimilarityWarning(null)
                  }}
                  rows={4}
                  autoFocus
                />
              ) : (
                <p className="issue-suggestion-text">{relatedSuggestion}</p>
              )}
            </div>
          )}

          <hr className="issue-detail-divider" />

          <div className="issue-detail-block">
            <span className="issue-detail-label">검증기준</span>
            <span className="issue-criteria-badge">{issue.criteria}</span>
          </div>

          <div className="issue-detail-block">
            <span className="issue-detail-label">검증이유</span>
            <p className="issue-reason-text">
              <QuoteHighlightedText text={issue.reason} quoteClassName="gradient-quote" />
            </p>
          </div>
        </div>

        {isEditing ? (
          <div className="issue-edit-actions-row">
            <button type="button" className="issue-edit-cancel" onClick={cancelEdit} disabled={saving}>
              수정 복구 ✕
            </button>
            <button
              type="button"
              className="issue-edit-save"
              onClick={() => void handleSaveClick()}
              disabled={saving || checkingSimilarity}
            >
              {saving ? '저장 중...' : checkingSimilarity ? '확인 중...' : '수정 저장 ✓'}
            </button>
          </div>
        ) : (
          <div className="issue-nav">
            <button
              type="button"
              className="issue-nav-prev"
              disabled={currentIssueIndex === 0}
              onClick={() => dispatch({ type: 'NAVIGATE_ISSUE', direction: 'prev' })}
            >
              {'< 이전'}
            </button>
            {currentIssueIndex < issues.length - 1 && (
              <button
                type="button"
                className="issue-nav-next"
                onClick={() => dispatch({ type: 'NAVIGATE_ISSUE', direction: 'next' })}
              >
                {'다음 >'}
              </button>
            )}
          </div>
        )}

        {isEditing && warningAcknowledged && !issueLikelyResolved && (
          <p className="issue-edit-notice">
            원래 문제였던 표현이 아직 남아있어요. 정말 해결됐으면 "수정 저장"을 한 번 더 눌러주세요.
          </p>
        )}
        {isEditing && similarityWarning && (
          <p className="issue-edit-notice">
            {similarityWarning} 의도한 수정이 맞으면 "수정 저장"을 한 번 더 눌러주세요.
          </p>
        )}
        {isEditing && saveError && <p className="issue-edit-notice issue-edit-notice-error">{saveError}</p>}
      </div>

      <div className="screen-footer">
        <Button className="btn-cta" onClick={() => void finishQA()} disabled={finishingQA}>
          QA 완료
        </Button>
      </div>
    </div>
  )
}
