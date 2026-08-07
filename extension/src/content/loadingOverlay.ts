// Figma SCREEN 00("문서 파싱")의 본문 카드 위에 겹쳐진 보라/핑크 그라데이션 레이어(mix-blend-lighten)를
// 그대로 재현 — 본문을 가져오는 동안 문서 화면 위로 은은하게 스캔하는 듯한 그라데이션이 흐르게 한다.
// Figma는 정적 스크린샷이라 애니메이션이 안 보이지만, 로딩 상태를 나타내려면 실제로 움직여야 한다.
const OVERLAY_ID = 'sunnic-loading-overlay'
const STYLE_ID = 'sunnic-loading-overlay-style'

const STYLE = `
@keyframes sunnic-loading-sweep {
  0% { background-position: 0% 50%; }
  100% { background-position: 100% 50%; }
}
#${OVERLAY_ID} {
  position: fixed;
  inset: 0;
  z-index: 2147483645;
  pointer-events: none;
  mix-blend-mode: lighten;
  background: linear-gradient(-47deg, #f7c4eb 0%, #d1aefb 35%, #f7c4eb 70%, #d1aefb 100%);
  background-size: 250% 250%;
  animation: sunnic-loading-sweep 1.8s linear infinite;
  opacity: 0.75;
}
`

function ensureStyleInjected(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = STYLE
  document.head.appendChild(style)
}

export function showLoadingOverlay(): void {
  ensureStyleInjected()
  if (document.getElementById(OVERLAY_ID)) return
  const overlay = document.createElement('div')
  overlay.id = OVERLAY_ID
  document.body.appendChild(overlay)
}

export function hideLoadingOverlay(): void {
  document.getElementById(OVERLAY_ID)?.remove()
}
