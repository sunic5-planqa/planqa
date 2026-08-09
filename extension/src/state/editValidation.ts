// "AI 제안과 비슷한지"는 이제 백엔드(POST /issues/similarity-check)가 판단한다 — 여기 남은 건
// 네트워크 없이 즉시 계산 가능한 로컬 체크(수정한 텍스트에 원래 문제였던 문구가 아직도 남아있는지)뿐.
export function isIssueLikelyResolved(inputText: string, editedText: string): boolean {
  return inputText.trim() === '' || !editedText.includes(inputText)
}
