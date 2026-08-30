// 3d(완료 요약) 전용 CSS 전용 마스코트 — 다른 화면이 쓰는 이미지 마스코트(.mascot, PNG 스프라이트)와는
// 별개다. 디자인 핸드오프(.dc.html)의 정확한 마크업을 그대로 옮김: 그라데이션 타일 + 흰 라운드
// 바디 + 보라 눈 2개, 전부 CSS 도형이라 이미지 파일이 필요 없다.
export function Mascot() {
  return (
    <div className="mascot-summary" aria-hidden="true">
      <span className="mascot-summary-body">
        <span className="mascot-summary-eye" />
        <span className="mascot-summary-eye" />
      </span>
    </div>
  )
}
