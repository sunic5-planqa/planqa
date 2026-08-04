# 써니C (SunniC) — Backend

LLM 기반으로 서비스 기획서(기획안)의 품질을 자동 검증해주는 도구의 백엔드. Confluence 페이지 위에 사이드 패널로 뜨는 크롬 익스텐션에서 사용한다.

SK SunniC (Cohort 5), 팀 "물개와 써니들"

## 핵심 흐름

기획 문서 붙여넣기 → 마크다운 구조 파싱 → 계층별(문서/챕터/문단/문장) QA 검증 → 이슈(위치/기준/이유/제안) 제시 → 사용자가 적용/스킵/직접수정 → 최종본 복붙(export).

AI는 기획서를 임의로 수정하지 않는다. 문제 위치·이유·근거·제안까지만 하고, 반영 여부는 사용자가 결정한다.

## 셋업

```
uv sync
cp .env.example .env   # ANTHROPIC_API_KEY 채우기
uv run uvicorn sunnic_backend.main:app --reload
```

`GET /healthz` 로 기동 확인, `GET /docs` 에서 API 스펙 확인.

## API

| # | 엔드포인트 | 기능 |
|---|---|---|
| 1 | `POST /documents` | 마크다운 텍스트 접수 + 구조 파싱 |
| 2 | `POST /documents/{id}/qa-jobs` | QA 검증 시작 (비동기) |
| 3 | `GET /qa-jobs/{job_id}/status` | 진행 상태 조회 (폴링) |
| 4 | `GET /qa-jobs/{job_id}/issues` | 이슈 리스트 조회 |
| 5 | `PATCH /issues/{issue_id}` | 적용/스킵/직접수정 반영 |
| 6 | `GET /documents/{id}/export` | 최종 복붙용 텍스트 생성 |

QA는 문서/챕터/문단 레벨에서 저비용 모델(Haiku)로 1차 스크리닝 후 플래그된 구간만 정밀 모델(Sonnet)로 재검증하는 티어링 구조를 쓴다. 이 라우팅은 전부 백엔드 코드가 결정하며, LLM이 스스로 다른 모델을 호출하지 않는다.

## v1 스코프

**포함**: 마크다운(`#`/`##`) 기반 구조 파싱, 계층별(문서/챕터/문단/문장) QA 검증(단어 레벨 제외), 이슈별 위치/기준/이유/대치제안, apply/skip/edit, 복붙용 export.

**제외**: Confluence DOM 실시간 동기화, 영구 저장(DB), QA Level 강도 슬라이더, 문서 간 비교.
