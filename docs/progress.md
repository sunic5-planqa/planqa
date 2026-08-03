## 2026-08-04 — 백엔드 초기 스캐폴드

핸드오프 문서 기준으로 FastAPI 백엔드 프로젝트를 처음부터 구축했다.

- `uv`로 `src/sunnic_backend/` 패키지 스캐폴드 생성, FastAPI/uvicorn/anthropic/pydantic-settings 의존성 설치.
- `parsing/markdown_structure.py`: `#`/`##` 기반 문서→챕터→문단→문장 트리 파서. 모든 노드가 원본 텍스트 기준 `start`/`end` 오프셋을 가짐 (추후 apply/edit/export 시 오프셋 스플라이싱에 사용).
- `models/`: `Document`, `QAJob`, `Issue` Pydantic 모델.
- `storage/store.py`: in-memory 저장소 (asyncio.Lock으로 동시성 보호), 추후 SQLite로 교체 가능한 좁은 인터페이스.
- `api/documents.py`: `POST /documents` 실구현 (파싱 + 저장). 나머지 5개 엔드포인트(`qa-jobs`, `issues`, `export`)는 OpenAPI 스펙에 노출되도록 라우터에 등록만 하고 스텁으로 남김.
- `main.py`: FastAPI app + lifespan(Anthropic client 초기화) + `/healthz`.
- 이전 `planqa-eval-agent` 프로젝트에서 가져왔던 무관한 문서(`docs/progress.md`, `docs/adr/0001-review-agent-output-contract.md`)는 `docs/archive/`, `docs/adr/archive/`로 이동. README.md/CLAUDE.md는 이번 프로젝트 기준으로 재작성.
- 실제 API로 데모하다 발견: 번호목록이 2개 이상일 때 문장 분리기가 다음 항목의 마커("2.")를 이전 문장의 종결부호로 잘못 인식해 두 항목이 한 문장으로 합쳐지는 버그 발견 → `_find_sentence_spans`를 목록 항목 경계로 먼저 분할한 뒤 각 구간 내에서 문장을 나누도록 수정, 회귀 테스트 추가로 12개 테스트 전체 통과 확인.

### Next

- `qa_engine/`: Haiku 1차 스크리닝 → 플래그된 구간만 Sonnet 재검증하는 라우팅/머지 로직, 계층별(문서/챕터/문단/문장) 프롬프트.
- `jobs/background.py`: `asyncio.create_task` 기반 QA job 오케스트레이션, 진행률/카테고리 갱신.
- `POST /documents/{id}/qa-jobs`, `GET /qa-jobs/{job_id}/status`, `GET /qa-jobs/{job_id}/issues`, `PATCH /issues/{issue_id}`, `GET /documents/{id}/export` 실구현.
- 실제 API 키로 Haiku/Sonnet 프롬프트 검증 (구조화 출력 스키마 확정).
