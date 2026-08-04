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

- `qa_engine/`: **Gemini 2.5 Flash API 1차 스크리닝** → 플래그된 구간만 Sonnet 재검증하는 라우팅/머지 로직, 계층별(문서/챕터/문단/문장) 프롬프트. (기존 Haiku 스크리닝안에서 변경됨 — 8/4 결정)
- `jobs/background.py`: `asyncio.create_task` 기반 QA job 오케스트레이션, 진행률/카테고리 갱신.
- `POST /documents/{id}/qa-jobs`, `GET /qa-jobs/{job_id}/status`, `GET /qa-jobs/{job_id}/issues`, `PATCH /issues/{issue_id}`, `GET /documents/{id}/export` 실구현.
- 실제 API 키로 Gemini 스크리닝 + Sonnet 재검증 프롬프트 검증 (구조화 출력 스키마 확정).

## 2026-08-04 — QA 엔진 Gemini 스크리닝 클라이언트 (`feature/qa-engine-llm-client`)

1단계 스크리닝을 로컬 Qwen 대신 Gemini API로 가기로 결정(서버비 문제). `docs/adr/`에 남겨야 할 결정이지만 이번엔 클라이언트 레이어만 우선 포팅.

- `qa_engine/llm/base.py`, `qa_engine/llm/gemini.py`: 자매 프로젝트 `planqa-eval-agent`의 검증된 다중 키 라운드로빈 로직을 포팅하되, 이 프로젝트는 실제 async FastAPI라 **동기 클라이언트 대신 `google-genai`의 GA 비동기 클라이언트(`client.aio.models.generate_content`)로 재작성**. `DEFAULT_MODEL = "gemini-3.5-flash-lite"` (2.5 Flash-Lite는 10/16 지원 종료 예정이라 배포 목표 모델로 처음부터 실험).
- `factory.py`(백엔드 스왑 패턴)는 포팅 안 함 — Gemini/Sonnet은 고정 역할이라 교체 가능한 백엔드 추상화가 필요 없음.
- `config.py`에 `gemini_api_keys`(comma-separated, `NoDecode` 패턴) 추가. `app.state`에 아직 와이어링 안 함 — 라우팅 로직 브랜치에서 함께 연결.
- 테스트 23개(신규 11개 포함) 전체 통과, lint 클린. `genai_errors.ClientError`를 목킹 없이 실제 생성자로 구성해서 429 로테이션/재시도소진/즉시propagate 케이스 검증.

### Next

- 위 QA 엔진 Next 항목과 동일 + `app.state.gemini_client` 와이어링은 라우팅 로직과 함께.

## 2026-08-04 — 크롬 익스텐션 스캐폴드 (`extension/`)

Manifest V3 + React + Vite + TypeScript로 사이드패널 익스텐션을 새로 추가했다. `feature/chrome-extension` 브랜치(`dev`에서 분기).

- `extension/`: `@crxjs/vite-plugin`으로 MV3 빌드. 사이드패널(`src/sidepanel/`) + 백그라운드 서비스워커(`chrome.sidePanel.setPanelBehavior`)만 두고 content script는 만들지 않음(Confluence DOM 실시간 동기화는 v1 제외 스펙).
- `api/`: 6개 백엔드 엔드포인트 전부 타입 있는 클라이언트로 미리 정의(`types.ts`가 백엔드 Pydantic 모델과 1:1 대응). 501 스텁은 `NotImplementedError`로 던져서 화면단에서 잡아 `fixtures.ts` 로컬 목데이터로 폴백.
- `state/`: React Context + `useReducer`. `AppStateContext.tsx`(Provider 컴포넌트)와 `hooks.ts`(useAppState/useAppDispatch)를 분리해 react-refresh 린트 경고 없앰.
- 5개 화면(PasteScreen → ProgressScreen → IssueListScreen → IssueEditScreen → HistoryExportScreen) 구현. `PasteScreen`만 실제 `POST /documents` 호출, 나머지는 실제 호출 우선 시도 후 501이면 fixture로 폴백해 전체 흐름이 데모 가능.
- 백엔드에 `CORSMiddleware` 추가(`main.py`, `config.py`의 `allowed_origins`). 크롬 익스텐션 ID를 고정하기 위해 `extension/scripts/generate-dev-key.mjs`로 dev용 RSA 키페어 생성 → `manifest.config.ts`가 `dev-key.public.txt`를 읽어 `key` 필드에 박음 (Web Store 배포용 키 아님). 생성된 ID를 `.env.example`의 `ALLOWED_ORIGINS`에 반영.
- **버전 호환성 이슈**: 이 머신의 Node가 v20.10.0인데 Vite 8/ESLint 10은 `node:util`의 `styleText`(Node 20.12+)를 요구해서 런타임에 크래시함 — Vite `^6.3.0` + `@vitejs/plugin-react@^4.7.0` + ESLint `^9.39.5`로 다운그레이드해서 해결. TypeScript는 `typescript-eslint`가 아직 TS 7을 지원하지 않아(peer `<6.1.0`) `^6.0.3`으로 고정.
- 검증: `npm run typecheck`, `npm run build`, `npm run lint` 전부 통과 (에러/경고 0개).

### Next

- ~~`chrome://extensions`에 실제 unpacked 로드해서 사이드패널 열림/텍스트 파싱 왕복(CORS 통과 여부) 수동 확인~~ — 완료, 사용자가 직접 로드해서 붙여넣기→이슈리뷰(fixture)→히스토리 전체 흐름 확인함.
- QA 엔진이 실제로 붙으면 각 화면의 fixture 폴백 분기 제거.
- `chrome.storage.session` 연동(패널이 닫혀도 진행 중이던 리뷰 상태 복원)은 스캐폴드에서 보류 — 필요성 확인되면 추가.

## 2026-08-04 — 컨플루언스 페이지 자동 불러오기 (`feature/confluence-content-extraction`)

QA 엔진(검토 에이전트) 핵심 로직 설계가 막혀있는 동안 우선순위를 옮겨 진행. 원래 핸드오프 문서에서 "컨플루언스 DOM 실시간 동기화"는 v1 제외 스트레치 골이었지만, 이번에 앞당겨 구현.

- **설계**: 페이지 DOM을 직접 스크래핑하지 않고 **컨플루언스 REST API**(`GET /wiki/rest/api/content/{pageId}?expand=body.storage`)를 사용 — 렌더링된 DOM은 매크로/위젯이 섞여 불안정하지만 Storage Format은 깔끔한 `h1~h6`/`p` 기반 semantic HTML이라 파싱이 안정적. 페이지 ID는 URL에서 정규식 추출.
- `extension/src/content/confluence-extractor.ts`: content script (`*://*.atlassian.net/*`). 페이지 origin 안에서 실행되므로 `fetch(..., {credentials:'include'})`가 사용자의 기존 세션 쿠키를 그대로 씀 — 별도 인증 불필요, same-origin이라 CORS 문제도 없음.
- `extension/src/content/confluenceParser.ts`: 순수함수 `htmlToChapterMarkdown` — 컨플루언스의 h1~h6 다단계 헤딩을 백엔드 파서가 이해하는 `##`(챕터) 한 단계로 평탄화. 매크로/표는 best-effort로 textContent만 추출.
- 변환 결과는 **기존 `PasteScreen`의 textarea에 채워넣기만** 함(자동 제출 안 함) — 사용자가 검토 후 직접 "QA 시작"을 눌러야 진행되는 기존 흐름/원칙(AI가 임의로 문서 확정 안 함) 그대로 유지. 백엔드는 전혀 수정 안 함.
- manifest에 `content_scripts` 추가했지만 `permissions`/`host_permissions`는 기존 그대로(변경 없음) — `chrome.tabs.sendMessage`는 별도 권한 없이 tabId만 있으면 호출 가능.
- **Vitest를 익스텐션에 처음 도입**(`vitest` + `happy-dom`). `confluenceParser`/`extractPageId`에 대한 순수 단위테스트 10개 작성, 전부 통과. `confluence-extractor.ts`가 모듈 로드 시 `chrome.runtime.onMessage.addListener`를 호출해서 테스트 환경에 최소 `chrome` 전역 스텁(`src/test-setup.ts`) 필요했음.
- 검증: `npm run build`, `npm run lint`, `npm run typecheck`, `npm run test` 전부 클린. 생성된 `dist/manifest.json`에 `content_scripts` 정상 등록 확인.

### Next

- ~~실제 컨플루언스 페이지에서의 왕복 테스트~~ — 완료, 사용자가 직접 언팩 로드해서 붙여넣기→이슈리뷰(fixture)→히스토리 전체 흐름 확인함.
- QA 엔진(검토 에이전트) 핵심 로직 — 여전히 최우선 순위, "방안 2" 세부 로직(섹션 쌍 개수 제한, 요약 정의, 문장 레벨 처리) 미정 상태.

## 2026-08-04 — 사이드패널 메인 화면 재설계 (`feature/main-screen-redesign`)

사용자가 공유한 와이어프레임이 지금까지의 textarea 붙여넣기 설계와 완전히 달라서 메인 화면을 전면 재설계. 원래 텍스트 핸드오프 문서와 상충되는 부분(QA Level 슬라이더는 "이번 프로토타입에서 뺌"이라 명시했었음)이 있었지만 사용자가 이 와이어프레임을 최신 기준으로 확정.

- **textarea/붙여넣기 완전 제거** — `rawText` 상태 삭제. 대신 `useConfluenceAutoDetect` 훅이 마운트 시 자동으로 현재 열린 탭의 컨플루언스 페이지를 감지(기존 `confluence-extractor.ts`/`confluenceParser.ts` 그대로 재사용, 버튼 클릭 대신 자동 실행으로 트리거만 변경). "리뷰 대상: {제목}" 상태 표시 + "다시 확인" 버튼.
- **References 섹션 — 로컬 파일 선택으로 구현**: 처음엔 Google Drive OAuth(`chrome.identity.getAuthToken` + Drive API v3)로 만들었으나, Google Cloud Console 수동 설정(OAuth 클라이언트 발급, 동의 화면, 테스트 사용자 등록)이 마찰 지점이라 판단해 같은 세션에서 **로컬 파일 선택(`<input type="file" multiple accept=".md">` + `File.text()`)으로 교체**. `extension/src/drive/`, `WorkDbSection.tsx`, `GOOGLE_DRIVE_SETUP.md` 전부 삭제. 선택한 파일은 체크박스로 다중 선택/해제하고 개별 제거(✕) 가능.
- **Custom 섹션(QA Level 슬라이더 + QA Factors 8개 체크박스) 완전 제거** — 와이어프레임에는 있었지만 사용자가 첫 화면에서 빼기로 결정. `CustomSection.tsx`/`QaLevelSlider.tsx`/`QaFactorsChecklist.tsx`/`state/qaFactors.ts` 및 관련 상태(`qaLevel`, `qaFactors`)·액션(`SET_QA_LEVEL`, `TOGGLE_QA_FACTOR`)·CSS 전부 삭제.
- **백엔드 변경 없음** — `selectedReferenceFileIds`는 익스텐션 상태에만 저장, 아직 전송 안 함(소비할 QA 엔진이 없어서). `MainScreen.tsx`에 TODO 주석으로 명시.
- `PasteScreen.tsx` → `MainScreen.tsx`로 리네임(더 이상 "붙여넣기" 화면이 아니라서). `appReducer.ts`에 처음으로 단위테스트 추가(기존엔 테스트 없었음).
- 검증: `appReducer` 테스트 포함 18개 전체 통과, `build`/`lint`/`typecheck` 클린. 빌드된 `manifest.json`에 `identity` 권한/`oauth2` 블록/`googleapis.com` host_permission 전부 빠진 것 확인.

### Next

- 선택된 참조 파일 내용을 실제로 QA 요청에 포함시키는 배선은 아직 없음 — QA 엔진이 생기면 함께 연결.
- QA 엔진(검토 에이전트) 핵심 로직 — 계속 최우선 순위.
