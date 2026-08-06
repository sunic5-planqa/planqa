// 로컬 목 컨플루언스 서버(backend/src/sunnic_backend/api/mock_confluence.py) 개발 편의용 —
// 회사 컨플루언스 계정 없이도 확장 아이콘 클릭 한 번으로 "문서 + 사이드패널" 데모 레이아웃을 재현한다.
// 실사용(실제 컨플루언스 페이지) 단계에서는 아이콘 클릭이 항상 이 목 문서를 띄우는 게 맞지 않으니 재검토 필요.
const MOCK_CONFLUENCE_URL = 'http://localhost:8000/mock-confluence/pages/482910'

// chrome.sidePanel.open()은 사용자 제스처(클릭) 핸들러 안에서 await 없이 "동기적으로" 호출해야 한다 —
// 앞에 await가 하나라도 끼면 제스처 컨텍스트가 소실돼 "may only be called in response to a user
// gesture" 에러가 난다. 그래서 새 OS 창을 만들고 그 창 id로 열던 이전 방식 대신, 클릭한 탭이 속한
// windowId로 즉시 패널부터 열고, 목 문서 로딩은 별도로(새 탭) 비동기 처리한다 — 한 창 안에 "왼쪽 문서 +
// 오른쪽 패널" 레이아웃이 나오는 건 동일하고, 브라우저 창을 새로 띄우는 것보다 이 제약에서 자유롭다.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(console.error)
})

chrome.action.onClicked.addListener((tab) => {
  if (tab.windowId !== undefined) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(console.error)
  }
  void ensureDemoDocumentTabOpen(tab)
})

async function ensureDemoDocumentTabOpen(clickedTab: chrome.tabs.Tab): Promise<void> {
  if (clickedTab.url?.startsWith('http://localhost:8000/mock-confluence/')) return

  const [existing] = await chrome.tabs.query({ url: 'http://localhost:8000/mock-confluence/*' })
  if (existing?.id !== undefined) {
    await chrome.tabs.update(existing.id, { active: true })
    return
  }

  await chrome.tabs.create({ url: MOCK_CONFLUENCE_URL, index: (clickedTab.index ?? -1) + 1 })
}
