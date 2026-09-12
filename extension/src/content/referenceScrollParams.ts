// 참고문서를 새 탭으로 열 때(confluence-extractor.ts) 그 탭 자신이 로드된 뒤 특정 위치로
// 스스로 스크롤하도록(issueOverlay.ts) URL에 실어 보내는 쿼리 파라미터 이름 — 두 파일이 같은
// 이름을 참조해야 하므로 한 곳에서만 정의한다.
export const REFERENCE_SCROLL_TEXT_PARAM = 'sunnicScrollText'
export const REFERENCE_SCROLL_LOCATION_PARAM = 'sunnicScrollLocation'
