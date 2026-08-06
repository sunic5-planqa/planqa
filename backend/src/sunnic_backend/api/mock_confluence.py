from fastapi import APIRouter, Query
from fastapi.responses import HTMLResponse

router = APIRouter(tags=["mock-confluence"])

# 실제 회사 컨플루언스 계정 없이도 확장 프로그램(content script)을 로컬에서 왕복 테스트할 수 있도록
# 컨플루언스 REST API(`/wiki/rest/api/content/...`) 응답 형태를 흉내내는 목 서버.
# Figma 목업 SCREEN 00~05와 동일한 "결제 시스템 개선 기획서" 데모 문서를 사용해,
# 인라인 수정 오버레이가 하이라이트할 이슈 텍스트가 실제 렌더링된 문서와 그대로 맞아떨어지게 한다.
PAGE_ID = "482910"
PAGE_TITLE = "결제 시스템 개선 기획서 (PRD)"

BODY_STORAGE_HTML = """
<h2>1. 개요</h2>
<p>본 문서는 자사 커머스 플랫폼의 결제 시스템을 개편하여 결제 실패율을 낮추고, 다양한 간편결제 수단을 통합
지원하기 위한 기획 내용을 정리한 문서이다. 현행 PG사 연동 구조의 한계를 개선하고, 신규 결제 수단 확장에
대응 가능한 아키텍처로 전환하는 것을 목표로 한다.</p>
<h2>2. 배경 및 문제 정의</h2>
<p>최근 3개월간 결제 실패율이 4.2%로 전 분기 대비 1.1%p 상승하였으며, 특히 모바일 간편결제 구간에서 이탈이
두드러진다. 사용자 인터뷰 결과, 결제수단 선택 화면에서의 로딩 지연과 실패 시 재시도 안내 부족이 주요 원인으로
파악되었다.</p>
<ul>
<li>PG사 응답 지연 시 타임아웃 처리 로직 부재</li>
<li>간편결제(카카오페이, 네이버페이, 토스) 3사만 지원, 페이코 미지원</li>
<li>결제 실패 원인에 대한 사용자 안내 메시지 미흡</li>
</ul>
<h2>3. 목표</h2>
<p>결제 실패율을 2.0% 이하로 낮추고, 간편결제 지원 수단을 4종에서 7종으로 확대한다. 또한 결제 단계별
이탈률을 추적할 수 있는 로깅 체계를 구축하여 향후 개선 근거 데이터를 확보한다.</p>
<h2>4. 주요 요구사항</h2>
<table>
<tbody>
<tr><th>구분</th><th>내용</th><th>우선순위</th></tr>
<tr><td>결제수단 확장</td><td>페이코, 삼성페이 추가 연동</td><td>High</td></tr>
<tr><td>실패 처리 개선</td><td>타임아웃 재시도 및 원인별 안내 메시지 제공</td><td>High</td></tr>
<tr><td>로깅 체계</td><td>결제 단계별 이벤트 로그 수집 및 대시보드 구축</td><td>Medium</td></tr>
</tbody>
</table>
<h2>5. 일정</h2>
<p>기획 확정 8월 3주차, 개발 착수 9월 1주차, QA 및 배포 10월 2주차를 목표로 진행한다.</p>
""".strip()

_PAGE_TEMPLATE = """<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<title>{title} - Confluence</title>
<style>
  body {{ margin: 0; font-family: -apple-system, "Apple SD Gothic Neo", sans-serif; background: #f4f5f7; color: #172b4d; }}
  header {{ display: flex; align-items: center; gap: 16px; padding: 12px 24px; background: #fff; border-bottom: 1px solid #dfe1e6; }}
  header .logo {{ font-weight: 700; color: #0052cc; }}
  header input {{ flex: 1; max-width: 320px; padding: 6px 10px; border: 1px solid #dfe1e6; border-radius: 4px; }}
  .banner {{ background: #fffae6; color: #172b4d; font-size: 12px; padding: 6px 24px; border-bottom: 1px solid #f8e6a0; }}
  main {{ max-width: 860px; margin: 24px auto; background: #fff; padding: 40px 56px; border-radius: 4px; box-shadow: 0 1px 2px rgba(9,30,66,.15); }}
  .breadcrumb {{ font-size: 12px; color: #6b778c; margin-bottom: 8px; }}
  h1 {{ margin: 0 0 4px; }}
  .byline {{ font-size: 12px; color: #6b778c; margin-bottom: 24px; }}
  h2 {{ font-size: 20px; margin-top: 32px; }}
  table {{ border-collapse: collapse; width: 100%; margin: 12px 0; }}
  th, td {{ border: 1px solid #dfe1e6; padding: 8px 12px; text-align: left; }}
  th {{ background: #f4f5f7; }}
</style>
</head>
<body>
<div class="banner">써니C 로컬 목 서버 — 실제 컨플루언스가 아닙니다. 확장 프로그램 개발/테스트 전용.</div>
<header><span class="logo">Confluence</span><input placeholder="검색" disabled /></header>
<main>
  <div class="breadcrumb">PROJ 스페이스 / 기획 문서 / 결제 시스템 개선</div>
  <h1>{title}</h1>
  <div class="byline">김지현 작성 · 3일 전 수정됨 · v4</div>
  {body}
</main>
</body>
</html>"""


@router.get("/mock-confluence/pages/{page_id}", response_class=HTMLResponse)
async def get_mock_confluence_page(page_id: str) -> str:
    return _PAGE_TEMPLATE.format(title=PAGE_TITLE, body=BODY_STORAGE_HTML)


@router.get("/wiki/rest/api/content/{page_id}")
async def get_content(page_id: str, expand: str = Query(default="")) -> dict:
    if "ancestors" in expand:
        return {"id": page_id, "title": PAGE_TITLE, "ancestors": []}
    return {"id": page_id, "title": PAGE_TITLE, "body": {"storage": {"value": BODY_STORAGE_HTML}}}


@router.get("/wiki/rest/api/content/{parent_id}/child/page")
async def get_child_pages(parent_id: str) -> dict:
    return {"results": []}
