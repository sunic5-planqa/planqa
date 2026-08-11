export function LoadingScreen() {
  return (
    <div className="screen loading-screen">
      <h1 className="panel-title">똑독</h1>
      <hr className="panel-divider" />
      <div className="mascot">
        <img src="/mascot/walk.png" alt="" />
      </div>
      <p className="loading-label">로딩 중...</p>
    </div>
  )
}
