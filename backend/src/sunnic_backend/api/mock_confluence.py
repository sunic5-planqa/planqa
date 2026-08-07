from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

router = APIRouter(tags=["mock-confluence"])

# 실제 회사 컨플루언스 계정 없이도 확장 프로그램(content script)을 로컬에서 왕복 테스트할 수 있도록
# 컨플루언스 REST API(`/wiki/rest/api/content/...`) 응답 형태를 흉내내는 목 서버.
# Figma 목업 SCREEN 00~05와 동일한 "결제 시스템 개선 기획서" 데모 문서를 사용해,
# 인라인 수정 오버레이가 하이라이트할 이슈 텍스트가 실제 렌더링된 문서와 그대로 맞아떨어지게 한다.
PAGE_ID = "482910"
PAGE_TITLE = "결제 시스템 개선 기획서 (PRD)"
SPACE_KEY = "MFS"

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

# References 섹션의 "컨플루언스 형제 문서 자동감지"가 실제로 뭔가 보여줄 수 있도록, 목 문서에도
# 상위 폴더 + 형제 문서 4개를 채워둔다. 각 형제 문서를 체크하면 실제로 이 본문이 그대로 fetch된다.
PARENT_ID = "482900"
PARENT_TITLE = "결제 시스템 개선"

_SIBLING_BODIES: dict[str, dict[str, str]] = {
    "482911": {
        "title": "결제 요구사항 정의서",
        "body": """
<h2>결제수단별 요구사항</h2>
<table>
<tbody>
<tr><th>결제수단</th><th>지원 여부</th><th>비고</th></tr>
<tr><td>카카오페이</td><td>지원</td><td>기존 연동</td></tr>
<tr><td>네이버페이</td><td>지원</td><td>기존 연동</td></tr>
<tr><td>토스</td><td>지원</td><td>기존 연동</td></tr>
<tr><td>페이코</td><td>미지원</td><td>이번 분기 신규 연동 검토</td></tr>
<tr><td>삼성페이</td><td>미지원</td><td>이번 분기 신규 연동 검토</td></tr>
</tbody>
</table>
<p>총 5종 중 3종만 지원 중이며, 페이코·삼성페이 추가 연동 시 5종 전체 지원이 완료된다.</p>
""".strip(),
    },
    "482912": {
        "title": "기획 회의록 (0728)",
        "body": """
<h2>참석자</h2>
<p>김지현, 이도영, 박서준</p>
<h2>논의 내용</h2>
<ul>
<li>결제 실패율 개선 목표치를 2.0%로 합의</li>
<li>페이코·삼성페이 연동 우선순위 High로 조정</li>
<li>QA 및 배포 일정은 10월 2주차 유지</li>
</ul>
""".strip(),
    },
    "482913": {
        "title": "결제 API 명세서",
        "body": """
<h2>결제 요청 API</h2>
<p>POST /api/v2/payments — 결제수단(method), 금액(amount), 주문번호(orderId)를 받아 결제를 요청한다.</p>
<h2>결제 상태 조회 API</h2>
<p>GET /api/v2/payments/{paymentId} — 결제 상태(성공/실패/타임아웃)를 조회한다.</p>
""".strip(),
    },
    "482914": {
        "title": "용어집",
        "body": """
<table>
<tbody>
<tr><th>용어</th><th>정의</th></tr>
<tr><td>PG사</td><td>결제 대행사(Payment Gateway)</td></tr>
<tr><td>간편결제</td><td>카드 정보를 매번 입력하지 않고 등록된 수단으로 결제하는 방식</td></tr>
<tr><td>타임아웃</td><td>PG사 응답이 일정 시간 내 오지 않아 요청이 실패 처리되는 상황</td></tr>
</tbody>
</table>
""".strip(),
    },
}

# 실제 컨플루언스처럼 PUT으로 본문을 갱신할 수 있어야 해서(인라인 오버레이의 "오류 수정하기"가 진짜
# 원문에 반영되는지 로컬에서 검증하려고) 각 페이지에 version을 붙인 뮤터블 상태로 관리한다.
# 서버 프로세스가 살아있는 동안만 유지되고, 재시작하면 원본 데모 내용으로 리셋된다.
_PAGES: dict[str, dict[str, object]] = {
    PAGE_ID: {"title": PAGE_TITLE, "body": BODY_STORAGE_HTML, "version": 4},
    **{page_id: {**page, "version": 1} for page_id, page in _SIBLING_BODIES.items()},
}
_CHILD_PAGE_IDS = [PAGE_ID, *_SIBLING_BODIES.keys()]

# QA 리뷰 중 만들어지는 복제본(원본은 안 건드리고 수정본만 별도 페이지로 쌓는 방식)에 쓸 id 카운터.
# 기존 데모 페이지 id(48291x)와 안 겹치게 별도 대역에서 시작한다.
_next_created_id = 900000

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
  <div class="breadcrumb">PROJ 스페이스 / 기획 문서 / {parent_title}</div>
  <h1>{title}</h1>
  <div class="byline">김지현 작성 · 방금 수정됨 · v{version}</div>
  {body}
</main>
</body>
</html>"""


@router.get("/mock-confluence/pages/{page_id}", response_class=HTMLResponse)
async def get_mock_confluence_page(page_id: str) -> str:
    page = _PAGES.get(page_id, _PAGES[PAGE_ID])
    return _PAGE_TEMPLATE.format(
        title=page["title"], parent_title=PARENT_TITLE, body=page["body"], version=page["version"]
    )


@router.get("/wiki/rest/api/content/{page_id}")
async def get_content(page_id: str, expand: str = Query(default="")) -> dict:
    page = _PAGES.get(page_id, _PAGES[PAGE_ID])
    result: dict = {"id": page_id, "title": page["title"]}
    if "ancestors" in expand:
        result["ancestors"] = [{"id": PARENT_ID, "title": PARENT_TITLE}]
    if "version" in expand:
        result["version"] = {"number": page["version"]}
    if "space" in expand:
        result["space"] = {"key": SPACE_KEY}
    if "body.storage" in expand or not expand:
        result["body"] = {"storage": {"value": page["body"]}}
    return result


@router.get("/wiki/rest/api/content/{parent_id}/child/page")
async def get_child_pages(parent_id: str) -> dict:
    if parent_id != PARENT_ID:
        return {"results": []}
    return {"results": [{"id": page_id, "title": _PAGES[page_id]["title"]} for page_id in _CHILD_PAGE_IDS]}


class _UpdateVersion(BaseModel):
    number: int


class _UpdateStorage(BaseModel):
    value: str
    representation: str = "storage"


class _UpdateBody(BaseModel):
    storage: _UpdateStorage


class UpdatePageRequest(BaseModel):
    version: _UpdateVersion
    title: str
    type: str = "page"
    body: _UpdateBody


class _Space(BaseModel):
    key: str


class _Ancestor(BaseModel):
    id: str


class CreatePageRequest(BaseModel):
    type: str = "page"
    title: str
    space: _Space
    ancestors: list[_Ancestor] | None = None
    body: _UpdateBody


@router.post("/wiki/rest/api/content")
async def create_content(request: CreatePageRequest) -> dict:
    global _next_created_id
    page_id = str(_next_created_id)
    _next_created_id += 1

    _PAGES[page_id] = {"title": request.title, "body": request.body.storage.value, "version": 1}
    return {
        "id": page_id,
        "title": request.title,
        "version": {"number": 1},
        "body": {"storage": {"value": request.body.storage.value}},
    }


@router.put("/wiki/rest/api/content/{page_id}")
async def update_content(page_id: str, request: UpdatePageRequest) -> dict:
    page = _PAGES.get(page_id)
    if page is None:
        raise HTTPException(status_code=404, detail="page not found")
    if request.version.number != int(page["version"]) + 1:
        raise HTTPException(status_code=409, detail="version conflict — someone else edited this page first")

    page["title"] = request.title
    page["body"] = request.body.storage.value
    page["version"] = request.version.number
    return {
        "id": page_id,
        "title": page["title"],
        "version": {"number": page["version"]},
        "body": {"storage": {"value": page["body"]}},
    }
