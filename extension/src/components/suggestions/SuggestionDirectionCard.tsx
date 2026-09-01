import type { IssueResponse } from '../../api/types'
import { useAppState } from '../../state/hooks'
import { QuoteHighlightedText } from '../common/QuoteHighlightedText'

type Target = 'primary' | 'related'

// 편집은 왼쪽 문서를 직접 클릭하는 것뿐이다(issueOverlay.ts의 setActiveSuggestion이 current
// 문단을 contentEditable로 만들고, 저장/취소 플로팅 박스를 띄운다) — 이 카드는 "수정 방향성
// 제안"(issue.suggestion)을 읽기 전용으로 보여주며 문서에서 고치라고 안내만 한다. 예전엔 문서에서
// 못 찾았을 때를 위한 "여기서 직접 수정" 텍스트 영역 폴백이 있었으나, 실사용 중 혼란만 준다는
// 피드백으로 제거했다(2026-08-30) — 매칭 실패 자체는 issueOverlay.ts의 findAnchorElement가 헤딩
// 폴백까지 시도하고, 그래도 실패하면 콘솔 경고를 남긴다.
//
// 어느 위치(primary/related)를 보여주는지는 위치 내비게이터가 가리키는 activeLocationIndex를
// 그대로 따른다 — 문서 쪽 틴트도 같은 값을 기준으로 움직이므로 패널과 문서가 항상 같은 위치를
// 가리킨다.
export function SuggestionDirectionCard({ issue }: { issue: IssueResponse }) {
  const { activeLocationIndex, issueEdits } = useAppState()

  const target: Target = activeLocationIndex === 1 && issue.related_original_text ? 'related' : 'primary'
  const isInsertRangeIssue = issue.frame_type === 'insert_range'

  const edit = issueEdits[issue.id]
  const savedText = target === 'related' ? edit?.relatedEditedText : edit?.editedText
  const baseSuggestion = target === 'related' ? issue.related_original_text ?? '' : issue.suggestion
  const displayText = savedText ?? baseSuggestion
  const resolved = savedText !== undefined

  return (
    <div className="suggestion-direction-card">
      <div className="suggestion-direction-header">
        <span className="issue-detail-label">수정 방향성 제안</span>
        {!isInsertRangeIssue && resolved && <span className="resolved-badge">✓ 수정완료</span>}
      </div>

      <p className="suggestion-direction-text">
        <QuoteHighlightedText text={displayText} quoteClassName="gradient-quote" />
      </p>

      {!isInsertRangeIssue && !resolved && (
        <p className="issue-suggestion-hint">왼쪽 문서에서 해당 문단을 클릭하면 바로 고칠 수 있어요.</p>
      )}

      {isInsertRangeIssue && (
        <p className="issue-suggestion-hint">
          문서에 없는 내용을 추가하라는 안내라, 자동으로 반영할 수 없어요. 문서에서 표시된 위치를 직접
          확인하고 반영해주세요.
        </p>
      )}
    </div>
  )
}
