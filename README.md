# 써니C (SunniC)

LLM 기반으로 서비스 기획서(기획안)의 품질을 자동 검증해주는 도구. Confluence 페이지를 열면 사이드 패널로 뜨는 크롬 익스텐션(`extension/`)과, QA 검증을 실제로 수행하는 FastAPI 백엔드(`backend/`)로 구성된 모노레포다.

SK SunniC (Cohort 5), 팀 "물개와 써니들"

## 핵심 흐름

1. Confluence 페이지를 열면 익스텐션이 본문을 자동으로 읽어와 마크다운 구조로 파싱한다.
2. 저비용 모델(Gemini)로 전체를 1차 스크리닝하고, 플래그된 구간만 정밀 모델(Sonnet)로 재검증하는 2단계 QA를 돌린다.
3. 발견된 이슈는 문서 위에 바로 하이라이트된다. 하이라이트를 클릭하면 위치·기준·이유·대치 제안이 담긴 말풍선이 뜨고, 실제 수정은 오른쪽 사이드 패널에서 한다.
4. **원본 페이지는 절대 건드리지 않는다.** 첫 수정을 저장하는 순간 원본의 자식 페이지로 복제본이 하나 생기고, 이후 수정은 전부 그 복제본에 누적된다.
5. 마지막 화면에서 원본/수정본을 토글하며 비교하고, 검토 내역을 클릭하면 해당 위치로 바로 이동해 확인할 수 있다.

AI는 기획서를 임의로 수정하지 않는다. 문제 위치·이유·근거·제안까지만 하고, 반영 여부와 저장 시점은 항상 사용자가 결정한다.

### SCREEN 04 — 문서 인라인 수정

문서 위 하이라이트를 클릭해 AI 제안을 확인하고, 오른쪽 패널에서 수정 내용을 다듬어 저장하는 화면. 저장은 복제본에만 반영된다.

![SCREEN 04. 문서 인라인 수정 와이어프레임](docs/images/screen04-inline-edit.png)

## 셋업

### 백엔드 (`backend/`)

```
cd backend
uv sync
cp .env.example .env   # ANTHROPIC_API_KEY, GEMINI_API_KEYS 채우기
uv run uvicorn sunnic_backend.main:app --reload
```

`GET /healthz` 로 기동 확인, `GET /docs` 에서 API 스펙 확인.

### 크롬 익스텐션 (`extension/`)

```
cd extension
npm install
npm run build
```

`chrome://extensions`에서 "압축해제된 확장 프로그램 로드"로 `extension/dist`를 불러오면 된다. 개발 중엔 `npm run dev`(HMR)도 가능.

익스텐션 아이콘을 누르면 사이드 패널이 열린다. 지금 보고 있는 탭이 Confluence 페이지면 그 페이지를 대상으로 QA를 시작할 수 있다.

## API

| # | 엔드포인트 | 기능 |
|---|---|---|
| 1 | `POST /documents` | 마크다운 텍스트 접수 + 구조 파싱 |
| 2 | `GET /documents/count` | 지금까지 검토한 문서 수 조회 |
| 3 | `POST /documents/{id}/qa-jobs` | QA 검증 시작 (비동기) |
| 4 | `GET /qa-jobs/{job_id}/status` | 진행 상태 조회 (폴링) |
| 5 | `GET /qa-jobs/{job_id}/issues` | 이슈 리스트 조회 |
| 6 | `PATCH /issues/{issue_id}` | 적용/스킵/직접수정 반영 |
| 7 | `GET /documents/{id}/export` | 최종 결과 텍스트 생성 |

QA 라우팅(어느 이슈를 정밀 모델까지 보낼지)은 전부 백엔드 코드가 결정하며, LLM이 스스로 다른 모델을 호출하지 않는다.

## v1 스코프

**포함**: 마크다운(`#`/`##`) 기반 구조 파싱, 계층별(문서/챕터/문단/문장) QA 검증(단어 레벨 제외), 이슈별 위치/기준/이유/대치제안, apply/skip/edit, 원본 보존 + 복제본 저장.

**제외**: 영구 저장(DB), QA Level 강도 슬라이더, 문서 간 비교.
