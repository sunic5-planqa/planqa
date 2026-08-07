// 아이콘을 클릭한 탭에 사이드패널을 연다 — 그 탭이 실제 회사 컨플루언스 페이지든, 로컬 목 서버
// (backend/src/sunnic_backend/api/mock_confluence.py)의 목업 페이지든 상관없이 "지금 보고 있는 탭"을
// 그대로 리뷰 대상으로 삼는다. 예전엔 클릭 시 목업 문서 탭으로 강제 이동시켰는데, 그러면 실제
// 컨플루언스 페이지를 보고 있어도 목업으로 끌려가버려서 제거함 — 목업을 테스트하고 싶으면 그 URL로
// 직접 이동한 뒤 아이콘을 누르면 된다.
//
// sidePanel.open()은 사용자 제스처(클릭) 핸들러 안에서 await 없이 "동기적으로" 호출해야 한다 —
// 앞에 await가 하나라도 끼면 제스처 컨텍스트가 소실돼 "may only be called in response to a user
// gesture" 에러가 난다.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(console.error)
})

chrome.action.onClicked.addListener((tab) => {
  if (tab.windowId === undefined) return
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(console.error)
})
