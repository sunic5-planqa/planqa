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

## 2026-08-05 — 모노레포 폴더 구조 전환 (`feature/monorepo-restructure`)

프론트(익스텐션)를 같은 저장소에서 계속 관리하기로 하면서, 백엔드가 루트를 독차지하던 구조를 정리. 이 시점엔 이미 `main`에 chrome-extension 체인 전체(스캐폴드/컨플루언스 자동감지/메인화면 재설계)와 `qa-engine-llm-client`가 다른 경로로 먼저 머지돼 있었음 — `dev`는 그보다 뒤처져 있어서 `dev`를 `main`으로 fast-forward한 뒤 이 작업을 시작.

- 백엔드 코드(`src/`, `tests/`, `pyproject.toml`, `uv.lock`, `.python-version`, `.env.example`, `.env`)를 전부 `backend/` 아래로 이동. `extension/`은 이름 그대로 유지(이미 명확한 이름이라 "frontend"로 바꾸지 않음), `docs/`는 백엔드/프론트 공통 기록이라 루트에 유지.
- `config.py`의 `env_file=".env"`가 CWD 기준 상대경로라, `backend/`에서 실행하는 한 별도 코드 변경 없이 그대로 동작 — `.venv`만 삭제 후 `backend/`에서 `uv sync`로 재생성.
- `.gitignore`의 `.venv/`, `.pytest_cache/`, `.env` 같은 패턴은 경로 앵커가 없어 `backend/` 하위에서도 그대로 매치됨 — 수정 불필요.
- `README.md`/`CLAUDE.md`를 모노레포 기준으로 업데이트: 셋업 섹션에 `cd backend`/`cd extension` 구분 추가, README의 "저비용 모델(Haiku)" 문구를 실제 구현(Gemini)에 맞게 수정.
- 검증: `backend/`에서 `uv run pytest` 25개 전체 통과, `uv run uvicorn ...`으로 새 위치에서 정상 기동(lifespan/설정 로딩 확인) — 다만 로컬에 이미 떠 있던 구경로 기준 서버와 포트 충돌이 있어서 실제 바인딩까지는 확인 못 함, 사용자 쪽에서 기존 프로세스 정리 후 재확인 필요.

### Next

- GitHub Actions 등 CI는 아직 없어서 경로 변경으로 인한 워크플로 수정은 불필요했음(향후 CI 추가 시 `backend/` 기준으로 작성).
- 레포 이름(`planqa-backend`)이 이제 backend+extension을 다 담는 이름이 아니라서 변경 검토 예정.
- QA 엔진(검토 에이전트) 핵심 로직 — 계속 최우선 순위.

## 2026-08-05 — 컨플루언스 형제 문서 자동감지 (`feature/confluence-sibling-references`)

메인 문서 자동감지에 이어, 그 문서의 상위 컨플루언스 페이지를 찾아 형제 문서들을 References 섹션에 체크박스로 보여주는 기능 추가. 로컬 파일 선택 기능(직전 세션에서 구현)은 그대로 유지 — 둘 다 같은 `referenceFiles`/`selectedReferenceFileIds` 상태로 합쳐짐.

- **컨플루언스 REST API 2단계**: `GET /wiki/rest/api/content/{pageId}?expand=ancestors`로 직속 상위 페이지 id 조회(ancestors 배열의 마지막 항목) → `GET /wiki/rest/api/content/{parentId}/child/page?limit=100`로 형제 페이지 목록(자기 자신 제외) 조회. 목록만 먼저 가볍게 가져오고, 본문은 사용자가 체크했을 때만 별도로 가져옴(불필요한 API 호출 최소화).
- `confluence-extractor.ts`의 기존 `extractCurrentPage` 로직에서 fetch+마크다운 변환 부분을 `fetchPageMarkdown(pageId)` 공용 헬퍼로 분리 — 메인 문서 감지와 형제 문서 본문 가져오기 둘 다 재사용. 상위/형제 파싱 로직은 `parseAncestorParentId`/`parseSiblingPages` 순수함수로 분리해 단위테스트.
- `useConfluenceSiblingDocs` 훅 — `useConfluenceAutoDetect`와 동일 패턴, `confluenceStatus === 'detected'`가 되면 자동 실행.
- `ConfluenceSiblingRow` — 체크하면 그 시점에 `FETCH_PAGE_MARKDOWN` 메시지로 본문을 가져와 `REFERENCE_FILES_ADDED`(id=컨플루언스 페이지 id)로 저장, 체크 해제하면 `REMOVE_REFERENCE_FILE`. 목록 자체(`confluenceSiblingDocs`)는 유지되니 재체크 가능.
- `ReferencesSection.tsx`를 "컨플루언스 형제 문서" / "로컬 파일" 두 서브섹션으로 분리 — `referenceFiles` 배열에서 형제문서 id를 필터링해 로컬 파일 목록에 안 섞이게 처리.
- 백엔드 변경 없음 — References는 여전히 QA 엔진이 없어서 백엔드로 전송 안 함.
- 검증: 신규 순수함수(`parseAncestorParentId`, `parseSiblingPages`) + 리듀서 액션 테스트 포함 24개 전체 통과, `build`/`lint`/`typecheck` 클린.

### Next

- **Claude가 검증 불가능한 것**: 실제 상위/하위 구조가 있는 컨플루언스 스페이스에서 상위 감지 → 형제 목록 → 체크 → 본문 변환 왕복. 사용자가 직접 언팩 리로드해서 확인 필요.
- QA 엔진 핵심 로직(스크리닝→검증)이 없어서 막힌 것들 — 재검증 루프(두 위치 간 이슈 표현하려면 `Issue` 모델에 두 번째 위치 필드 필요), AI 제안 vs 사용자 수정 유사도 비교, 챕터별 개별 로딩 상태(`QAJobStatusResponse` 확장 필요). 전부 QA 엔진 코어가 먼저 있어야 함 — 계속 최우선 순위.

## 2026-08-05 — QA 흐름 와이어프레임 매칭, fixture 기반 (`feature/qa-flow-wireframe-visuals`)

사용자가 공유한 로딩→진행→이슈리뷰→수정→검토완료 와이어프레임 6장을 기준으로 화면 구현 상태를 점검. 카테고리별 실시간 진행률과 AI 재검증은 QA 엔진 코어가 없어서 못 만들지만(여전히 스크리닝/검증 로직 없음, "방안 2" 내부 설계도 미확정), 화면 구조/비주얼은 기존 fixture 폴백 패턴 위에서 지금 바로 맞출 수 있어 이 부분만 먼저 진행.

- `api/types.ts`에 `CategoryItemStatus`/`CategoryItem`/`ProgressCategory` 추가, `QAJobStatusResponse.categories`를 옵셔널로 추가(백엔드는 미변경 — 이 필드는 fixture에서만 채워짐).
- 신규 화면 `LoadingScreen.tsx`("QA 시작" 클릭 직후, `MainScreen`의 `handleStart`가 제일 먼저 `NAVIGATE loading` 디스패치) — 마스코트 이미지 자리(`/mascot/idle.png`)만 잡아둠, 실제 일러스트는 사용자가 추후 제공 예정.
- `ProgressScreen.tsx`: 진행률을 막대바(`%` 라벨 포함)로 바꾸고, `jobStatus.categories`가 있을 때 `CategoryTree`(신규, `components/progress/`) 렌더링 — 카테고리별 펼침/접기, 항목 상태(done/in_progress/pending)별 스타일. "QA 중지 Ⅱ" 버튼 추가(실제 pause API는 없어서 메인 화면으로 돌아가는 소프트 취소로 구현 — 화면 언마운트로 `useQAJobPolling`의 폴링도 자연히 멈춤). 미사용 상태였던 `Spinner.tsx`는 걷는 마스코트로 대체되며 삭제.
- `IssueListScreen.tsx`: 상단에 `OverviewPanel`(신규, `components/issues/`) 추가 — `groupIssuesByCriteria` 순수함수(신규 `state/issueGrouping.ts`, 단위테스트 3개)로 이슈를 검증기준별로 묶어 보여줌. "문서 오류 N개" 카운트를 기존 `issueEdits` 상태에서 파생(적용/수정된 이슈는 제외한 개수). 이미 적용/수정된 이슈는 대치제안 옆에 "✓ 수정완료" 배지 표시하되 수정하기는 계속 가능 — **실제 AI가 재검증한 게 아니라 사용자가 저장했다는 로컬 표시일 뿐**이라는 점을 명확히 구분해둠(진짜 재검증은 QA 엔진 몫).
- `HistoryExportScreen.tsx`: 원본/수정본 전체 텍스트 두 블록 비교를 없애고, 적용/수정된 이슈만 "원본→수정" 쌍으로 나열하는 리스트로 교체(클릭하면 로컬 강조만 — 실제 컨플루언스 페이지로 스크롤 이동은 이번 스코프 아님). "종료" 버튼 추가(메인으로 복귀). 클립보드 복사 로직(`buildWorkingTextPreview`)은 그대로 유지.
- 검증: `groupIssuesByCriteria` 테스트 포함 25개 전체 통과, `build`/`lint`/`typecheck` 클린.

### Next

- **마스코트 이미지 에셋 대기 중** — 사용자가 `extension/public/mascot/idle.png`(로딩), `extension/public/mascot/walk.gif`(진행) 파일을 주면 그대로 붙는 구조로 미리 만들어둠, 도착하면 바로 확인.
- "(서비스명)으로 210건의 문서가 검토됐어요" 같은 누적 통계는 저장할 곳이 없어서 스코프 제외.
- QA 엔진 핵심 로직 — 계속 최우선 순위. 이게 생겨야 진짜 카테고리별 실시간 진행률, 진짜 재검증(수정이 실제로 규칙을 해소했는지), AI 제안 vs 사용자 수정 유사도 비교까지 이어짐.

## 2026-08-06 — 목 컨플루언스 서버 + 본문 인라인 수정 오버레이

실제 회사 컨플루언스 계정 없이도 확장 프로그램을 로컬에서 왕복 테스트할 수 있게 하고, Figma UI 목업
(SCREEN 03/04)에 있던 "본문 위에 직접 뜨는 하이라이트 + AI 제안 툴팁"을 실제로 구현했다.

- **`backend/src/sunnic_backend/api/mock_confluence.py`(신규)**: 컨플루언스 REST API 응답 형태(`GET
  /wiki/rest/api/content/{id}?expand=body.storage|ancestors`, `GET /wiki/rest/api/content/{id}/child/page`)를
  그대로 흉내내는 목 엔드포인트 + `GET /mock-confluence/pages/{id}`(브라우저로 직접 여는 목 컨플루언스
  페이지 HTML). 문서 내용은 Figma 목업의 "결제 시스템 개선 기획서(PRD)"를 그대로 재사용 — 실제 화면에
  나왔던 이슈(간편결제 3사 vs 4장 요구사항의 페이코·삼성페이 불일치 등)와 텍스트가 정확히 맞아떨어지게.
  `main.py`에 라우터 등록, 테스트 4개(`tests/test_mock_confluence.py`) 추가.
- **`extension/src/content/issueOverlay.ts`(신규 content script)**: 사이드패널이 아니라 **문서 본문 위에
  직접** 이슈 텍스트를 하이라이트하고, 클릭하면 검증기준/검증이유/대치제안 + "오류 수정하기" 버튼이 담긴
  툴팁이 뜬다. 백엔드 파서 오프셋이 아니라 `TreeWalker`로 라이브 DOM 텍스트를 직접 검색해 `Range.
  surroundContents`로 `<mark>` 래핑 — 화면에 보이는 그대로를 기준으로 매칭한다. "오류 수정하기"를 누르면
  해당 구간 텍스트를 대치제안으로 바꾸고 초록색 "수정완료" 스타일로 전환, `chrome.runtime.sendMessage`로
  사이드패널에 결과를 통지(받는 쪽이 없어도 문서 위 수정 자체는 유효하므로 무시하고 진행).
  단위테스트 4개(`issueOverlay.test.ts`, happy-dom) 추가 — 매칭/비매칭/클릭→수정/초기화 전부 검증.
- **`extension/src/hooks/useIssueOverlaySync.ts`(신규)**: `issues` 화면(`issues`/`edit`)이 떠 있는 동안
  현재 탭에 `SHOW_ISSUE_OVERLAY`를 보내고, 화면을 벗어나면 `CLEAR_ISSUE_OVERLAY`로 정리. 본문에서 발생한
  `ISSUE_OVERLAY_RESOLVED` 메시지를 받으면 기존 `STAGE_ISSUE_EDIT` 액션으로 사이드패널 상태(`issueEdits`)에
  반영해서, 사이드패널의 "✓ 수정완료" 배지와 문서 위 표시가 같은 소스를 공유하게 함. `App.tsx`에 마운트.
- **`manifest.config.ts`**: `content_scripts.matches`/`host_permissions`에 `http://localhost:8000/*`,
  `http://127.0.0.1:8000/*`를 개발용으로 추가(주석으로 dev-only, 실배포 시 제거 대상 명시), `js` 배열에
  `issueOverlay.ts` 추가.
- **`extension/src/api/fixtures.ts`**: 기존 "동해의 바다" 데모 이슈 3개를 목 컨플루언스 문서와 텍스트가
  정확히 일치하는 "결제 시스템 개선 기획서" 이슈 3개로 교체(QA 엔진이 아직 없어 fixture로만 흐름 검증 중).
- 검증: 백엔드 `uv run pytest` 29개, 확장 `typecheck`/`lint`/`build`/`vitest` 38개 전부 통과. 빌드된
  `dist/manifest.json`에 두 content script와 로컬호스트 origin 정상 반영 확인. `/mock-confluence/pages/482910`,
  `/wiki/rest/api/content/482910?expand=body.storage` curl 응답 수동 확인.

### Next

- **Claude가 검증 불가능한 것**: 실제 Chrome에 언팩 리로드 후 `http://localhost:8000/mock-confluence/pages/482910`을
  열고 사이드패널에서 QA 시작(폴백 fixture로 동작) → 이슈 리뷰 화면 진입 시 본문에 하이라이트 3개가 실제로
  뜨는지, 클릭 → 툴팁 → "오류 수정하기" → 사이드패널 "✓ 수정완료" 배지 동기화까지 왕복 확인 필요.
  `backend/`는 `uv run uvicorn sunnic_backend.main:app --port 8000`으로 기동해야 확장의 `VITE_API_BASE_URL`
  기본값(`http://localhost:8000`)과 맞음.
- 오버레이는 문서당 **첫 매칭 1건만** 하이라이트한다(동일 문구가 여러 곳에 있으면 두 번째 이후는 무시) —
  지금 데모 문서는 문제 없지만, 실제 컨플루언스 문서에서 중복 표현이 흔하면 위치(`location`) 정보까지
  활용한 정밀 매칭이 필요할 수 있음.
- QA 엔진 핵심 로직 — 여전히 최우선 순위. 지금 오버레이는 fixture 데이터로만 동작하고, 실제 이슈가
  생기면 `input_text`가 라이브 DOM과 정확히 일치한다는 보장이 없어(백엔드는 마크다운 오프셋 기준) 매칭
  실패 케이스에 대한 처리(부분 매칭/공백 정규화 등)를 더 다듬어야 할 수 있음.

### 후속 수정 (같은 날, 실제 언팩 로드 테스트에서 발견된 버그 2건)

- **`sidePanel.open() may only be called in response to a user gesture`**: 아이콘 클릭 → `chrome.windows.
  create()` await → `sidePanel.open()` 순서로 짰더니, await를 한 번이라도 거치면 제스처 컨텍스트가
  소실돼 에러가 났다. `service-worker.ts`를 클릭한 탭의 `windowId`로 **await 없이 즉시** `sidePanel.
  open()`부터 호출하고, 목 문서 로딩(새 탭 열기/기존 탭 포커스)은 별도 비동기 함수로 분리하는 구조로
  변경 — 새 OS 창 대신 같은 창에 새 탭으로 열리지만 "왼쪽 문서 + 오른쪽 패널" 레이아웃은 동일하게 나옴.
- **CORS 차단(`No 'Access-Control-Allow-Origin' header`)**: 코드 문제가 아니라 **서버 실행 위치** 문제였음
  — `config.py`의 `env_file=".env"`가 CWD 기준 상대경로라, `backend/`가 아닌 다른 위치(레포 루트 등)에서
  `uv run uvicorn ...`을 실행하면 `.env`를 못 찾아 `ALLOWED_ORIGINS`가 빈 배열이 되고 모든 origin이
  차단됨. `.env`의 값 자체(`chrome-extension://lakdhpgnlleljlkkfobckijbnojlplcf`)는 처음부터 맞았음 —
  반드시 `cd backend && uv run uvicorn sunnic_backend.main:app --port 8000`으로 실행해야 함.
- **아이콘 클릭 시 실제 컨플루언스 페이지를 보고 있어도 목업 탭으로 강제 이동하는 버그**: 사용자가 실제
  회사 컨플루언스(`*.atlassian.net`) 페이지에서 아이콘을 눌렀는데 목업 PRD로 리뷰 대상이 뒤바뀌는
  문제를 사용자가 실제 스크린샷으로 재현해서 발견. 원인은 `service-worker.ts`의 "아이콘 클릭 시 목업
  탭 자동 오픈" 편의 기능이 현재 탭 종류를 가리지 않고 항상 실행됐던 것 — 이 로직을 완전히 제거하고,
  아이콘 클릭은 항상 **지금 보고 있는 탭**에 사이드패널만 여는 것으로 되돌림. 이후 사용자가 실제
  `gy30356635.atlassian.net`의 실 문서(DOC-001)에서 정상적으로 리뷰 대상/References 형제문서(폴더 내
  DOC-002~020)가 뜨는 것을 스크린샷으로 확인.

## 2026-08-06 — 인라인 수정이 실제 컨플루언스 원문에 반영되도록 변경

지금까지 "오류 수정하기"는 브라우저에 렌더링된 텍스트만 바꾸고(새로고침하면 원복) 실제 컨플루언스에는
저장되지 않았음. 사용자가 실제 원문이 바뀌어야 한다고 명확히 해서, 컨플루언스 REST API로 실제 쓰기까지
구현했다.

- **`backend/src/sunnic_backend/api/mock_confluence.py`**: 각 목 페이지에 `version` 필드를 추가해
  뮤터블 상태로 관리(서버 프로세스가 살아있는 동안만 유지, 재시작하면 리셋)하고, `PUT /wiki/rest/api/
  content/{page_id}`를 새로 구현 — 실제 컨플루언스와 동일하게 `version.number`가 `현재+1`이 아니면
  409, 성공하면 본문/제목/버전을 갱신. `expand=version`도 `GET`에서 지원하도록 확장. 목업 페이지
  HTML(`GET /mock-confluence/pages/{id}`)도 이제 저장된 최신 본문을 그대로 렌더링해서, 새로고침해도
  수정 내용이 남아있는지 로컬에서 검증 가능. 테스트 5개 추가(버전 충돌 409, 404, 정상 갱신 등).
- **`extension/src/content/issueOverlay.ts`**: "오류 수정하기" 클릭 시 `updatePageContent()`가
  1) `GET ?expand=body.storage,version`으로 최신 원문+버전 조회 → 2) `input_text`가 원문
  storage HTML에 실제로 있는지 확인(없으면 `TEXT_NOT_FOUND`로 실패 처리, 문서를 깨뜨리느니 아무것도
  안 함) → 3) 문자열 치환 후 `PUT`으로 저장(`X-Atlassian-Token: no-check` 헤더 포함 — 쿠키 세션
  인증 시 컨플루언스 클라우드의 XSRF 체크를 우회하기 위해 필요). 버튼은 "적용 중..." 로딩 상태를
  거치고, 실패하면 툴팁 안에 인라인 에러 메시지를 띄우고 버튼을 다시 활성화(재시도 가능) — 성공했을
  때만 하이라이트를 "수정완료"로 바꾸고 사이드패널에 알림. 표/목록처럼 렌더링 시 텍스트가 변형되는
  구간(쉼표로 합쳐진 목록 등)은 원본 storage HTML에 정확히 없을 수 있어 실패할 수 있음 — 알려진 한계로
  남겨둠.
- 검증: 백엔드 `uv run pytest` 35개, 확장 `typecheck`/`lint`/`build`/`vitest` 45개(성공/버전충돌/
  텍스트없음/PUT실패 각각의 오버레이 동작 포함) 전부 통과.

### Next

- **Claude가 검증 불가능한 것**: 실제 컨플루언스(DOC-001)에서 "오류 수정하기" 클릭 → 저장 성공 →
  페이지 새로고침해도 수정된 내용이 실제로 남아있는지 확인 필요. 계정에 해당 페이지 편집 권한이 있어야
  PUT이 200으로 성공함 — 403이 뜨면 권한 문제.
  버전 충돌(다른 사람이 그 사이에 편집한 경우) 시 지금은 에러 메시지만 띄우고 재시도를 사용자에게
  맡김 — 최신 버전을 자동으로 다시 받아와 재시도하는 로직은 아직 없음.
- QA 엔진 핵심 로직 — 여전히 최우선 순위.

## 2026-08-06 — "오류 수정하기"를 본문 위 직접 편집 모드로 변경

Figma SCREEN 04("4-1. 편집 모드로 변경", "4-2. 직접 수정안 적용")를 다시 확인해보니, 인라인 수정은
AI 제안을 원클릭 적용하는 게 아니라 **본문 위에서 사람이 직접 타이핑해 고치는 편집 모드**가 맞았다.
사이드패널이 아니라 문서 본문에서 바로 끝나야 한다는 요구사항도 반영.

- **`extension/src/content/issueOverlay.ts`**: "오류 수정하기" 클릭 → 바로 저장하던 것을 제거하고,
  대신 하이라이트(`<mark>`)가 `contentEditable`로 바뀌면서 AI 제안 텍스트가 미리 채워진 채 포커스+
  전체선택됨(바로 타이핑해서 덮어쓰거나 일부만 고칠 수 있음). 옆에 뜨는 "적용"/"취소" 버튼, 또는
  Enter(적용)/Esc(취소) 키로 확정. "적용"을 눌러야만 그 시점의 실제 텍스트(AI 제안 그대로든, 사람이
  고친 것이든)로 `updatePageContent()`가 호출돼 컨플루언스에 저장됨 — "취소"는 원문 텍스트로 복구하고
  아무 것도 저장하지 않음. 저장 중엔 "적용 중..." 라벨, 실패하면 원문으로 되돌리고 빨간 에러 라벨을
  잠깐 띄움(자동 사라짐).
- 검증: 확장 `typecheck`/`lint`/`build`/`vitest` 47개(편집 모드 진입/취소/사람이 고친 텍스트 적용/
  Esc 취소/저장 실패 시 롤백 각각 테스트) 전부 통과.

### Next

- **Claude가 검증 불가능한 것**: 실제 DOC-001에서 하이라이트 클릭 → "오류 수정하기" → 텍스트 직접
  수정 → 적용 → 새로고침해도 그 수정 내용이 남아있는지 확인.
- 사이드패널의 `IssueEditScreen`(직접 수정 화면)은 그대로 남아있음 — 본문 인라인 편집이 생겼으니
  이 화면이 계속 필요한지, 아니면 정리할지는 다음에 사용자와 확인.
- QA 엔진 핵심 로직 — 여전히 최우선 순위.

## 2026-08-06 — 원본 대신 복제본에 저장하도록 변경

사용자가 "적용"이 원본을 직접 덮어쓰지 않고, 수정본을 담은 별도 복제 페이지로 저장되길 원해서 변경.
원본 직접 수정 방식은 완전히 제거하고 복제본 방식만 남김(사용자 확정).

- **`backend/src/sunnic_backend/api/mock_confluence.py`**: `POST /wiki/rest/api/content`(페이지 생성)
  신규 구현 — 데모 페이지 id 대역(48291x)과 안 겹치는 카운터(900000~)로 새 id 발급. `GET .../content/
  {id}`가 `expand=space`도 지원하도록 확장(`SPACE_KEY = "MFS"`, 사용자의 실제 스페이스 키와 동일하게
  맞춤). 테스트 4개 추가(생성→조회→목업 페이지 렌더→그 복제본에 PUT까지 왕복, id 유일성).
- **`extension/src/content/issueOverlay.ts`**: 첫 "적용" 시 원본을 절대 안 건드리고 — 1) 원본을
  `expand=body.storage,space`로 읽어와 2) `POST /wiki/rest/api/content`로 원본 하위 페이지로 복제본을
  만든 뒤(제목: `"{원본 제목} (QA 검토 수정본 {생성 시각})"`) 3) 그 복제본에 바로 첫 수정을 반영.
  이후의 모든 "적용"은 같은 복제본(`duplicateSession`, 모듈 전역 — 페이지 새로고침 전까지 유지)에만
  누적 저장됨. 상태 라벨도 "복제본 생성 중..."/"복제본 생성됨: {제목}"/"복제본에 저장됨"으로 바꿔
  사용자가 원본이 아니라 복제본에 쌓이고 있다는 걸 알 수 있게 함.
- 검증: 백엔드 `uv run pytest` 38개, 확장 `typecheck`/`lint`/`build`/`vitest` 48개(첫 적용에서 원본 PUT이
  전혀 안 나가는지, 두 번째 적용부터 복제본을 재사용하는지, 복제본 생성 실패 시 롤백까지 포함) 전부 통과.

### Next

- **Claude가 검증 불가능한 것**: 실제 DOC-001에서 "오류 수정하기" → 적용 → 컨플루언스에 실제로
  `DOC-001 (QA 검토 수정본 ...)` 같은 이름의 새 하위 페이지가 생기는지, 원본은 그대로인지 확인 필요.
- 복제본 생성은 원본 페이지에 대한 "하위 페이지 생성" 권한이 있어야 함 — 계정에 그 권한이 없으면
  `ancestors` 지정이 거부될 수 있음(아직 실제 컨플루언스로 검증 못함).
- 세션이 탭 새로고침에 묶여 있어서, 리뷰 도중 새로고침하면 다음 적용에서 복제본이 또 하나 생김 —
  필요하면 `chrome.storage.session`으로 pageId를 영속화하는 걸 고려할 수 있음(지금은 스코프 아님).
- QA 엔진 핵심 로직 — 여전히 최우선 순위.

## 2026-08-06 — 본문 가져오는 동안 그라데이션 오버레이 애니메이션

Figma SCREEN 00("문서 파싱") 노드를 `get_design_context`로 다시 확인해보니, 문서 카드 위에 실제로
`mix-blend-mode: lighten` 그라데이션 레이어(`154:219`, 보라↔핑크 대각선)가 겹쳐 있었음 — 정적
스크린샷이라 안 보였을 뿐, 로딩 중 문서 위로 은은하게 도는 효과를 의도한 게 맞았다.

- **`extension/src/content/loadingOverlay.ts`(신규)**: Figma와 동일한 그라데이션(`#f7c4eb ↔ #d1aefb`,
  -47deg)을 `mix-blend-lighten`으로 얹는 `position: fixed` 오버레이. `background-position`을
  애니메이션시켜 실제로 화면을 스캔하듯 흐르게 함(`pointer-events: none`이라 클릭은 그대로 통과).
  `showLoadingOverlay()`/`hideLoadingOverlay()` 두 함수만 export.
- **`extension/src/content/confluence-extractor.ts`**: `extractCurrentPage()`(사이드패널이 열리며 본문을
  자동으로 가져오는 함수)의 fetch 구간을 `try/finally`로 감싸 시작 시 오버레이를 띄우고 끝나면(성공/
  실패 무관) 반드시 치움. 별도 메시지 왕복 없이 content script 내부에서 직접 show/hide — 이미 본문
  fetch 자체가 그 스크립트 안에서 일어나므로 사이드패널을 거칠 필요가 없었음. `manifest.config.ts`
  변경 없음(같은 content script 번들에 묶여 들어감).
- 검증: 확장 `typecheck`/`lint`/`build`/`vitest` 52개(오버레이 생성/중복방지/제거/빈 상태 제거 각각
  테스트) 전부 통과.

### Next

- **Claude가 검증 불가능한 것**: 실제 DOC-001을 처음 여는 순간(사이드패널이 자동으로 본문을 감지하는
  구간)에 그라데이션이 실제로 화면 위에 흐르는지, 로딩 끝나면 깔끔히 사라지는지 확인.
- 지금은 뷰포트 전체를 덮는 방식(`position: fixed; inset:0`) — Figma는 문서 카드 영역에만 덮여 있는데,
  실제 컨플루언스 DOM 구조가 테마/버전마다 달라 "본문 카드"만 안정적으로 특정하기 어려워서 낸 절충안.
  필요하면 나중에 컨플루언스의 본문 컨테이너 셀렉터를 찾아 범위를 좁힐 수 있음.
- QA 엔진 핵심 로직 — 여전히 최우선 순위.

## 2026-08-06 — MainScreen에서 "리뷰 대상"/"다시 확인" 제거, 로딩 화면으로 교체

Figma SCREEN 01(References) 목업을 다시 보니 "리뷰 대상: {제목}" 문구나 "다시 확인" 버튼이 애초에
없었음 — 본문을 가져오는 동안(SCREEN 00)은 마스코트 + "본문 가져오는 중..." 로딩바만 있고, 다 가져오면
바로 References/QA 시작 화면으로 넘어가는 구조가 원안이었다.

- **`extension/src/components/screens/MainScreen.tsx`**: `confluenceStatus`가 `idle`/`detecting`일 때는
  기존 `LoadingScreen`과 같은 패턴(마스코트 걷는 애니메이션 + 얇은 그라데이션 로딩바, 신규
  `.progress-bar-thin`)으로 조기 반환 — "리뷰 대상"/"다시 확인" 없이 로딩만 보여줌. `detected` 상태가
  되면 바로 References/QA 시작 화면으로 넘어가고, 여기서도 "리뷰 대상" 문구는 안 보여줌(옆에 실제
  컨플루언스 페이지가 열려있으니 굳이 제목을 또 보여줄 필요가 없다고 판단). "다시 확인" 버튼은
  `not_confluence`/`error` 상태(컨플루언스 페이지가 아니거나 로딩 실패)에서만 복구 수단으로 남겨둠 —
  Figma엔 없는 상태지만, 재시도 수단을 완전히 없애면 실패 시 사이드패널을 닫았다 여는 것 말고는 복구
  방법이 없어서 최소한으로 유지.
- `extension/src/styles/global.css`에 `.progress-bar-thin`/`.progress-bar-thin-fill`(그라데이션이
  좌우로 스윕하는 얇은 인디케이터 바, 실제 %를 모르니 확정 진행률 대신 무한 스윕 애니메이션 사용) 추가.
- 검증: `typecheck`/`lint`/`build`/`vitest` 52개 전부 통과(이 화면 자체는 기존에도 컴포넌트 테스트가
  없어서 신규 테스트는 추가 안 함 — 기존 컨벤션 그대로).

### Next

- **Claude가 검증 불가능한 것**: 실제 DOC-001을 열 때 "본문 가져오는 중..." 로딩 화면이 뜨고, 끝나면
  "리뷰 대상" 문구 없이 바로 References 화면으로 자연스럽게 넘어가는지 확인.
- QA 엔진 핵심 로직 — 여전히 최우선 순위.

## 2026-08-06 — SCREEN 01(QA 준비) 색상/버튼을 Figma 토큰에 맞춤

`get_design_context`로 SCREEN 01 노드를 다시 뜯어봐서 실제 색상 값을 뽑아냈다. 기존 `--accent`가
목업과 무관한 주황(`#ffb020`)이었던 것부터 시작해 전반적으로 브랜드 컬러가 안 맞았음.

- **`extension/src/styles/global.css`**: `:root`에 Figma 실측값 기반 토큰 추가 —
  `--accent: #8b5fd9`(Medium Purple), `--accent-gradient`(보라→핑크 135deg, 버튼용),
  `--accent-contrast: #2e1750`(그라데이션 위 텍스트), `--success: #2e9e5b`, `--text-heading:
  #1a1a1e`, `--text-muted: #8a8a93`, `--text-body: #3c3c43`. `.panel-title`/`.references-heading`/
  `.references-count`/`.confluence-db-status`/`.status-dot`/`.resolved-badge`에 반영.
- **`.btn-cta`(신규)**: Figma의 "QA 시작" 버튼 그대로 — 전체 너비, `height:50px`, `border-radius:25px`,
  보라→핑크 그라데이션 배경, `#2e1750` ExtraBold 텍스트, `box-shadow: 0 6px 8px rgba(201,169,255,.45)`.
  기존 `.btn-bracket`(`[ QA 시작 ▶ ]`) 대신 이걸 씀 — 다른 화면의 bracket 버튼(QA 중지, QA 완료 등)은
  Figma에 이 필 버튼 스타일이 없어서 안 건드림. 버튼 텍스트도 Figma대로 "QA 시작"(화살표 제거).
- **체크박스**: `ConfluenceSiblingRow.tsx`의 네이티브 체크박스를 커스텀 스타일로 — 미체크 시 회색 테두리
  사각형, 체크 시 그라데이션 배경 + 흰 체크마크(`::after`). `input`은 시각적으로 숨기되 클릭/키보드
  접근성은 그대로 유지(`opacity:0`로 겹쳐놓는 방식, `display:none` 아님).
- 검증: `typecheck`/`lint`/`build`/`vitest` 52개 전부 통과(색상/마크업 변경이라 신규 테스트 없음).

### Next

- 다른 화면(IssueListScreen의 적용/스킵, HistoryExportScreen의 문서 복사 등)도 각자 대응하는 Figma
  화면(03/04/05)의 정확한 색상·버튼 스타일을 아직 안 맞춰봄 — 필요하면 각 화면별로 같은 방식(
  `get_design_context`로 실측 후 토큰화)으로 이어서 할 수 있음.
- QA 엔진 핵심 로직 — 여전히 최우선 순위.

## 2026-08-06 — 다크모드 고정 해제 + 디테일(정렬/글자 크기) 보정

사용자가 패널이 까맣게 보인다고 해서 확인해보니, `color-scheme: light dark`만 있고 배경/텍스트를
명시적으로 안 정해둬서 OS 다크모드를 따라 브라우저가 배경을 검게 자동 전환하고 있었음 — Figma가
라이트 전용 디자인이라 시스템 설정과 무관하게 항상 라이트로 고정해야 했다.

- **`extension/src/styles/global.css`**: `color-scheme: light`로 고정(`light dark` → `light`),
  `body`에 `background:#fff; color:var(--text-body)` 명시 — 이제 시스템이 다크모드여도 패널은 항상
  Figma와 같은 흰 배경으로 렌더링됨.
- **`.panel-title`**: `text-align: center` → `left` — Figma 노드가 `items-start`(왼쪽 정렬)였음.
- **References 주변 글자 크기 축소**: `.references-count`/`.confluence-db-status`/`.status-dot`
  0.75~0.8rem → 0.68rem, `.folder-toggle`/`.reference-file-row` 0.85rem → 0.76rem,
  `.reference-file-row label` 0.8rem → 0.73rem — 보조 정보들이 제목보다 확실히 작아 보이도록.
- 검증: `typecheck`/`lint`/`build`/`vitest` 52개 전부 통과(스타일 변경이라 신규 테스트 없음).

### Next

- QA 엔진 핵심 로직 — 여전히 최우선 순위.

## 2026-08-06 — QA 시작 버튼을 패널 하단에 고정

Figma의 "Overlay+Shadow" 푸터(References 목록은 `overflow-auto`로 스크롤되고, 버튼은 그 아래 별도
영역에 그림자와 함께 고정)를 그대로 재현 — 지금까지는 버튼이 References 목록 다음에 그냥 이어져서
내용이 길어지면 스크롤해야 보였음.

- **`extension/src/styles/global.css`**: `.app`에 `min-height:100vh` 추가(내용이 짧아도 패널 높이를
  꽉 채워야 버튼이 맨 아래에 붙음). `.screen.main-screen`을 `flex:1; min-height:0`으로 만들어 `.app`
  안에서 남는 높이를 차지하게 하고, 내부를 `.main-screen-scroll`(제목/References, `overflow-y:auto`)과
  `.main-screen-footer`(버튼, `flex-shrink:0`, 위쪽 그림자 `0 -8px 20px rgba(0,0,0,.03)`, `.app`의
  16px 패딩을 음수 마진으로 상쇄해서 패널 가장자리까지 꽉 채움)로 분리.
  다른 화면(IssueListScreen 등)의 `.qa-start-row`는 그대로 둬서 영향 없음 — 이번 요청은 MainScreen
  한정이라 새 클래스로 분리해 블라스트 레디어스를 좁힘.
- **`MainScreen.tsx`**: 반환 JSX를 위 두 영역으로 감싸도록 재구성. 로딩 상태(SCREEN 00) 분기는 그대로.
- 검증: `typecheck`/`lint`/`build`/`vitest` 52개 전부 통과.

### Next

- 같은 패턴(스크롤 영역 + 하단 고정 푸터)이 다른 화면(IssueListScreen/HistoryExportScreen)에도
  필요한지는 아직 안 물어봤음 — 필요하면 이어서 적용 가능.
- QA 엔진 핵심 로직 — 여전히 최우선 순위.

## 2026-08-06 — SCREEN 03(QA 결과 확인) 프론트 구현

`get_design_context`로 SCREEN 03 노드를 뜯어서 Overview 카드/이슈 상세 카드/하단 고정 버튼까지
그대로 옮겼다. 진행 전에 확인한 것: Figma엔 "적용"/"스킵" 버튼이 없고 "오류 수정하기"(밑줄 링크) +
하단 고정 "QA 완료" 버튼만 있어서, 사용자 확인 후 적용/스킵 버튼은 제거하고 "오류 수정하기"만 남김
(클릭하면 기존 IssueEditScreen으로 이동 — 거기서 AI 제안 그대로 적용하거나 직접 고쳐서 저장 가능).

- **`.screen`/`.screen-scroll`/`.screen-footer`(공용화)**: 지난번 MainScreen 전용으로 만들었던
  `.screen.main-screen`/`.main-screen-scroll`/`.main-screen-footer`를 `.screen`/`.screen-scroll`/
  `.screen-footer`로 일반화 — 이제 하단 고정 푸터가 필요한 화면이면 어디서든 재사용 가능. MainScreen도
  이 이름으로 갈아탐(동작 변화 없음).
- **`OverviewPanel.tsx`**: 아코디언(펼치기/접기) 방식을 버리고 Figma대로 카드 목록으로 재설계 —
  카드마다 기준명 + 미리보기 문구(`input_text`, ellipsis로 말줄임) 한 줄. 지금 보고 있는 이슈의
  기준과 일치하는 카드만 `overview-card-active`(보라 인셋 테두리 1.5px, 진한 텍스트, ▾)로 강조,
  나머지는 회색 톤 + ▸. 카드를 클릭하면 그 기준의 첫 이슈로 바로 이동(신규 리듀서 액션
  `SELECT_ISSUE_BY_ID` 추가).
- **`IssueListScreen.tsx`**: `<dl>` 기반 목록 → Figma 카드 레이아웃(`issue-detail-card`)으로 교체 —
  입력내용 / 수정제안(+오류 수정하기 링크, 수정완료 시 배지로 대체) / 구분선 / 검증기준(보라 필 배지)
  / 검증이유. "이전/다음" 텍스트 네비게이션 재스타일링. "QA 완료"는 이제 마지막 이슈에서만 뜨던 것에서
  **항상 하단에 고정**되도록 변경(Figma가 이슈 1/3 화면에서도 이미 보이고 있었음 — 검토 도중 언제든
  종료 가능하게).
  - Figma의 "수정제안" 텍스트는 실제로는 `issue.suggestion`이 아니라 섹션명을 그라데이션으로
    강조한 별도 설명 문구였음(예: "2. 배경 및 문제 정의의 간편결제 방식과 4. 주요 요구사항의...") —
    지금 데이터 모델(`Issue`)엔 그런 필드가 없어서 그 그라데이션 텍스트 연출은 재현하지 않고
    `issue.suggestion`을 평문으로 표시함. 알고 있는 제한사항으로 남겨둠.
- 검증: `typecheck`/`lint`/`build`/`vitest` 54개(신규 `SELECT_ISSUE_BY_ID` 리듀서 테스트 2개 포함)
  전부 통과.

### Next

- HistoryExportScreen(SCREEN 05)도 같은 방식으로 아직 안 맞춰봄.
- QA 엔진 핵심 로직 — 여전히 최우선 순위.

## 2026-08-07 — "N건의 문서가 검토됐어요" 실제 통계로 구현

MainScreen에 남겨뒀던 TODO(stats-api)를 실제로 채웠다 — 가짜 숫자를 보여주기 싫어서 미뤄뒀던 부분이라,
백엔드에 진짜 카운트를 추적하는 엔드포인트부터 추가했다.

- **`backend`**: `Store.count_documents()`(in-memory 문서 수) + `GET /documents/count` 신규.
  "검토됐어요"라고 하지만 실제로는 QA 엔진이 없어서 "완료된 검토"가 아니라 `POST /documents`가
  호출된(리뷰가 시작된) 횟수로 근사 — 주석으로 명시해둠. 서버 재시작하면 0으로 리셋(다른 in-memory
  데이터와 동일한 한계). 테스트는 절대값이 아니라 호출 전후 증가분(+1)으로 검증 — `store`가 테스트
  세션 전체에서 공유되는 싱글턴이라 절대 카운트를 단언하면 테스트 순서에 취약해짐.
- **`extension`**: `api.getDocumentCount()` 추가. `MainScreen`이 마운트 시 한 번 불러와서
  `.screen-footer` 안 버튼 위에 "**AI QA Service**으로 / {count}건의 문서가 검토됐어요" 표시(Figma와
  동일한 두 줄 구성, 브랜드명은 보라 강조 나머지는 회색). 통계 호출이 실패해도 조용히 문구만 안
  보여주고 화면은 정상 동작(부가 정보 취급).
- 검증: 백엔드 `uv run pytest` 39개, 확장 `typecheck`/`lint`/`build`/`vitest` 54개 전부 통과. 로컬에서
  `GET /documents/count` → `POST /documents` → 다시 `GET /documents/count`로 0→1 증가 실제 확인.

### Next

- QA 엔진이 생기면 "리뷰 시작 수"가 아니라 "완료된 검토 수" 기준으로 바꾸는 게 더 정확함(주석에 남김).
- QA 엔진 핵심 로직 — 여전히 최우선 순위.

## 2026-08-07 — 편집을 문서 대신 오른쪽 패널로 이동 (SCREEN 04 재확인)

SCREEN 04를 다시 자세히 보니, 본문 위 "AI 제안" 말풍선은 항상 같은 모양의 읽기 전용 안내이고, 실제
편집("수정 진행 중...", 수정 복구/수정 저장)은 **오른쪽 패널의 이슈 카드 안에서** 일어나는 구조였다
(별도 화면 전환도 아니고, Overview/문서오류N개는 그대로 보이는 채로 카드만 편집 모드로 바뀜). 지난번엔
본문에서 직접 contenteditable로 고치게 만들었는데, 그건 이번에 다시 보니 Figma 원안과 달랐다 — 확인
후 오른쪽 패널 인라인 편집으로 전면 교체.

- **`extension/src/content/issueOverlay.ts`**: contentEditable 편집 모드(`enterEditMode`, 적용/취소
  플로팅 버튼, "적용 중..." 상태 라벨)를 전부 제거. 하이라이트 클릭 시 이제 **통일된 읽기 전용
  "AI 제안" 말풍선**(제목 + `issue.suggestion` 한 줄, 버튼 없음)만 뜨고, 동시에
  `chrome.runtime.sendMessage({type:'ISSUE_OVERLAY_FOCUS', issueId})`로 사이드패널에 포커스 이동을
  요청한다. 컨플루언스 쓰기(복제본 생성/저장) 로직은 그대로 남기되, DOM 편집 흐름이 아니라 사이드패널이
  보내는 `APPLY_ISSUE_EDIT` 요청에 응답하는 형태로 전환(`applyIssueEdit` 함수, 테스트용으로 export).
  성공하면 해당 하이라이트만 `resolved` 스타일로 바뀜(실제 라이브 페이지 텍스트는 안 바뀌므로 표시
  텍스트는 그대로 둠 — 원본을 안 건드린다는 원칙 유지).
- **`messages.ts`**: `IssueOverlayResolvedMessage` 제거, `IssueOverlayFocusMessage`(content→사이드패널,
  fire-and-forget)와 `ApplyIssueEditRequest/Response`(사이드패널→content, 요청/응답) 추가.
- **`useIssueOverlaySync.ts`**: 오버레이 활성 조건을 `screen === 'issues'`만으로 단순화(더 이상 별도
  'edit' 화면이 없음). `ISSUE_OVERLAY_FOCUS` 수신 시 `SELECT_ISSUE_BY_ID` + `START_EDIT_ISSUE` 디스패치.
- **상태(`appReducer.ts`/`types.ts`)**: `editingIssueId: string | null` 추가, `START_EDIT_ISSUE`/
  `STOP_EDIT_ISSUE` 액션 신규. 이슈를 이동(`NAVIGATE_ISSUE`/`SELECT_ISSUE_BY_ID`)하면 편집 중이던 것도
  자동 취소되도록 `editingIssueId`를 같이 초기화 — 저장 안 한 초안을 들고 있다가 나중에 엉뚱하게 다시
  편집 모드로 뜨는 걸 방지.
- **`IssueListScreen.tsx`**: "오류 수정하기" 클릭(또는 문서 위 말풍선 클릭으로 포커스 이동)하면 같은
  카드 안에서 "수정제안" 자리가 textarea로 바뀌고 라벨이 "수정 진행 중..."으로 바뀜(검증기준/검증이유는
  그대로 보임). 카드 하단에 "수정 복구 ✕"(회색 텍스트, 초안을 버리고 취소) / "수정 저장 ✓"(보라 볼드,
  `APPLY_ISSUE_EDIT` 전송)이 뜸 — Figma와 동일 위치. `IssueEditScreen.tsx`(별도 화면)는 이제 아무도
  안 써서 삭제, `Screen` 타입에서 `'edit'`도 제거.
  - React 훅 안티패턴 회피: "편집 모드 진입 시 AI 제안으로 초안을 채운다"를 `useEffect` + `setState`로
    하면 eslint `react-hooks/set-state-in-effect`에 걸려서, 대신 `draft: {issueId, text} | null` 상태를
    렌더 중에 파생시키는 패턴으로 바꿈(`draft.issueId`가 지금 이슈와 다르면 AI 제안으로 폴백) — effect
    없이 항상 올바른 초안이 나옴.
- 검증: 확장 `typecheck`/`lint`/`build`/`vitest` 57개(읽기전용 말풍선/포커스 알림/복제본 생성-재사용-
  실패 각 케이스/리듀서 신규 액션 2개 포함) 전부 통과.

### Next

- **Claude가 검증 불가능한 것**: 실제 DOC-001에서 본문 하이라이트 클릭 → 오른쪽 패널이 그 이슈의 편집
  모드로 바로 전환되는지, "수정 저장" 후 본문의 해당 박스가 초록(resolved)으로 바뀌는지 확인.
- QA 엔진 핵심 로직 — 여전히 최우선 순위.

## 2026-08-07 — 실사용 중 발견된 오버레이 버그 3건 수정

사용자가 실제 DOC-001에서 테스트하다 발견: 이슈 3개 중 박스가 1개만 뜨고, 클릭해도 "AI 제안" 말풍선이
전혀 안 보임. 로컬 목 서버에서만 확인했던 것들이라 실제 컨플루언스의 복잡한 CSS/마크업에서만 드러난
문제였다.

- **박스가 1개만 뜨던 원인**: `findMatch`가 `input_text`와 DOM 텍스트를 정확히(공백 한 칸까지) 일치해야
  찾는 `indexOf` 방식이었음 — 백엔드가 마크다운으로 평탄화하며 공백을 한 칸으로 접었지만, 실제 렌더링된
  HTML은 공백이 여러 칸이거나 줄바꿈이 껴 있을 수 있어 문단 텍스트조차 매칭에 실패하는 경우가 있었다.
  `input_text`의 공백을 `\s+`로 바꾼 정규식으로 느슨하게 매칭하도록 변경(`buildLooseTextRegex`) —
  표/목록처럼 아예 다른 요소로 쪼개지는 구간은 여전히 못 찾음(알려진 한계로 유지).
- **말풍선이 전혀 안 뜨던 원인**: 툴팁을 `position:absolute`로 `document.body`에 붙였는데, 실제
  컨플루언스 페이지의 `body`(또는 그 조상)에 `position:relative` 등이 걸려있으면 그 요소 기준으로
  좌표가 계산돼 엉뚱한 위치(대개 화면 밖)에 그려짐 — 로컬 목 서버는 마크업이 단순해서 이 문제가 안
  드러났었다. `position:fixed`로 바꿔 뷰포트 기준 좌표를 그대로 쓰도록 해서, 호스트 페이지의 CSS와
  무관하게 항상 정확한 위치에 뜨게 함(스크롤하면 말풍선이 하이라이트를 따라가진 않지만, 클릭 직후
  잠깐 뜨는 용도라 문제 없음).
- **오른쪽 → 왼쪽 자동 스크롤(신규 기능)**: `SCROLL_TO_ISSUE` 메시지 추가. `useIssueOverlaySync`가
  현재 보고 있는 이슈 id(`issues[currentIssueIndex]`)가 바뀔 때마다(이전/다음, Overview 카드 클릭,
  문서 클릭으로 포커스 이동 등) 전송 → content script가 해당 하이라이트를
  `scrollIntoView({behavior:'smooth', block:'center'})`로 화면 중앙에 보이게 함.
- 검증: 확장 `typecheck`/`lint`/`build`/`vitest` 61개(공백 관대한 매칭/이슈 여러 개 동시 하이라이트/
  scrollToIssue 성공·실패 케이스 포함) 전부 통과.

### Next

- **Claude가 검증 불가능한 것**: 실제 DOC-001에서 이슈 3개 전부 박스가 뜨는지, 클릭 시 말풍선이 정확한
  위치에 보이는지, 이전/다음 눌렀을 때 문서가 해당 박스로 부드럽게 스크롤되는지 확인.
- 표/목록에서 파생된 이슈 문구는 여전히 매칭 실패 가능 — 필요하면 표/목록 렌더링 구조까지 고려한
  매칭(여러 텍스트 노드에 걸친 검색)으로 확장할 수 있음.
- QA 엔진 핵심 로직 — 여전히 최우선 순위.

## 2026-08-07 — 이슈 2개 누락/박스 색상 실측/말풍선 컨테이너 재점검

사용자가 실제 DOC-001에서 재현: 3개 중 2개가 박스가 안 쳐졌는데, 그중 하나가 "버전: v1.0 | 작성일:
... | 상태: 검토 중" 같은 메타데이터 줄이었음 — 컨플루언스에서 "상태" 값은 별도 뱃지(lozenge)
엘리먼트로 렌더링되는 경우가 많아서, 사람 눈엔 한 줄이지만 실제로는 라벨 텍스트 노드와 뱃지 엘리먼트가
분리돼 있어 "한 텍스트 노드 안에서만 찾는" 기존 매칭 방식으로는 아예 못 찾는 구조였다. 박스 색깔도
Figma 실측(`get_design_context`, SCREEN 03의 하이라이트 박스 노드)해보니 `border-2 border-[#b583ef]
border-solid rounded-[10px]`로, 배경 채움이나 그라데이션 없는 **순수 테두리**였다 — 지금까지 반투명
보라 배경(rgba fill)을 깔고 있었던 게 사용자에게 "그라데이션처럼 보인다"로 읽힌 것으로 보임.

- **`extension/src/content/issueOverlay.ts`**: 매칭을 텍스트 노드 단위 → **body 전체를 하나의
  문자열로 이어붙여 검색**하는 방식으로 재작성(`collectTextSpans`). 매치가 여러 텍스트 노드에 걸치면
  겹치는 구간마다 각각 `<mark>`로 감싸되(`Range.surroundContents`는 엘리먼트 경계를 넘는 단일 범위를
  못 감싸므로) 같은 `data-sunnic-issue-id`를 공유시켜 하나처럼 보이게 함. `marksByIssueId`를
  `Map<string, HTMLElement>` → `Map<string, HTMLElement[]>`로 변경, 리졸브/스크롤 로직도 배열 전체를
  다루도록 수정.
- **박스 스타일**: Figma 실측값 그대로 — `background: transparent`, `border: 2px solid #b583ef`,
  `border-radius: 10px` (기존 반투명 배경 채움 제거).
- **말풍선 컨테이너**: `document.body` → `document.documentElement`로 변경 — body 자체(또는 그 사이
  어딘가)에 transform/filter가 걸려 있으면 그게 `position:fixed`의 containing block이 될 수 있는데,
  html까지 그런 경우는 거의 없어서 이 경로로 한 번 더 안전장치를 둠.
- 검증: 확장 `typecheck`/`lint`/`build`/`vitest` 63개(라벨+뱃지처럼 여러 엘리먼트에 걸친 매칭, 그
  경우의 리졸브 전파 포함) 전부 통과.

### Next

- **Claude가 검증 불가능한 것**: 실제 DOC-001에서 이번엔 3개 전부 박스가 뜨는지, 박스가 순수 테두리로
  보이는지(배경 안 깔림), 말풍선이 정확한 위치에 뜨는지 다시 확인 필요 — 이미 두 차례 "고쳤다고 했는데
  실제로는 안 됐던" 이력이 있어서 이번에도 신중하게 재확인 요청.
- QA 엔진 핵심 로직 — 여전히 최우선 순위.

## 2026-08-07 — 오른쪽 패널에서 이슈 넘길 때 AI 제안 말풍선 자동 표시

문서 하이라이트를 직접 클릭했을 때만 "AI 제안" 말풍선이 뜨던 것을, 오른쪽 패널에서 이전/다음이나
Overview 카드로 이슈를 옮겨다닐 때도 자동으로 뜨도록 확장 — 왼쪽을 따로 클릭할 필요 없게.

- **`extension/src/content/issueOverlay.ts`**: `issuesById`(Map) 추가해서 하이라이트할 때 이슈
  데이터를 같이 저장해둠. `toggleTooltip`을 `showTooltip`(항상 열기)으로 분리하고, 클릭 시의 "같은
  이슈면 닫기" 토글 판단은 클릭 핸들러 쪽으로 옮김. `scrollToIssue()`(기존엔 스크롤만 하던 함수)가
  스크롤과 동시에 `showTooltip()`도 호출하도록 변경 — `useIssueOverlaySync`가 현재 이슈 id 바뀔 때마다
  이미 이 함수를 호출하고 있어서, 그 경로 하나만 고치면 이전/다음/Overview 카드 클릭/문서 클릭으로
  포커스 이동 전부 자동으로 말풍선까지 뜨게 됨.
- 검증: 확장 `typecheck`/`lint`/`build`/`vitest` 64개(scrollToIssue가 말풍선도 띄우는지 포함) 전부 통과.

### Next

- 문서 클릭 → ISSUE_OVERLAY_FOCUS → 사이드패널 상태 변경 → SCROLL_TO_ISSUE 왕복 때문에, 클릭 직후
  말풍선이 한 번 닫혔다 다시 열리는 아주 짧은 깜빡임이 있을 수 있음 — 기능상 문제는 없어서 일단 둠.
- QA 엔진 핵심 로직 — 여전히 최우선 순위.

## 2026-08-07 — SCREEN 04 오른쪽 패널 디테일을 Figma 실측값에 정확히 맞춤

`get_design_context`로 SCREEN 04(143:5407)의 편집 상태 우측 패널을 다시 뜯어보니, 지난번 구현과
구조/색이 여러 군데 어긋나 있었다.

- **그라데이션 텍스트(보라→핑크)**: `.issue-editing-status`("수정 진행 중...")와
  `.issue-suggestion-text`("수정제안" 값)는 검정색이 아니라 실제로 `background-clip:text` 그라데이션
  이었음 — 각각 정확한 색 스톱(`#b583ef→#fbc7ea`, `#b583f0→#e8639f`)으로 반영. References/Overview
  제목처럼 실측상 평범한 단색인 다른 헤딩들은 그대로 뒀음(전부 그라데이션으로 바꾸면 오히려 Figma와
  달라짐).
- **레이아웃 재배치**: "수정 진행 중..."이 "수정제안" 라벨 옆이 아니라 카드 위쪽에 독립된 줄로 —
  "문서 오류 N개" 자리를 편집 중엔 이걸로 대체. "수정 복구 X / 수정 저장 V" 행은 회색 카드 **밖으로**
  이동(원래 카드 안에 넣었던 게 실수) — 평소의 "이전/다음" 자리를 편집 중엔 이걸로 대체.
  "수정제안" 영역은 편집 중일 때만 흰 카드로 살짝 띄움(`box-shadow`, `border-radius:10px`) —
  평소엔 회색 카드와 같은 배경.
- **문구**: "그래도 저장" 같은 변형 문구 제거, 항상 "수정 저장"(Figma에도 이렇게만 있었음). "수정 복구"
  텍스트 색을 `#b4b4bc` → 실측값 `#939393`으로 보정.
- **경고 문구 위치**: "AI 제안과 많이 달라요" / "원래 문제였던 표현이 남아있어요" 알림을 텍스트박스
  바로 아래(카드 안)에서 **카드+수정복구/저장 행 다음, 하단 고정 QA 완료 버튼 바로 위**로 옮기고
  스타일도 옅은 보라 배경의 둥근 카드(`.issue-edit-notice`)로 다듬음 — 에러는 빨간 톤으로 구분.
- 검증: 확장 `typecheck`/`lint`/`build`/`vitest` 64개 전부 통과(레이아웃/색상 변경이라 신규 테스트 없음).

### Next

- 여전히 "수정제안" 텍스트의 부분별 그라데이션(섹션명만 그라데이션, 나머지 검정)은 재현 안 함 —
  Issue 데이터 모델에 그 구조가 없어서 전체를 균일하게 그라데이션 처리함(알려진 단순화).
- QA 엔진 핵심 로직 — 여전히 최우선 순위.

## 2026-08-07 — SCREEN 05(최종 QA 검토) 구현, "적용 및 종료" → "검토 종료"로 개명

`get_design_context`로 SCREEN 05(143:5592)를 실측 — "QA 검토" 옆 원본/수정본 세그먼트 토글, 진행
카드 스타일 diff 목록, 하단 그라데이션 버튼까지 확인. **"문서 복사" 버튼은 이 화면에 아예 없었음** —
클립보드 export 기능은 더 이전 와이어프레임의 잔재였던 것으로 보여 제거.

- **용어 판단**: Figma엔 버튼 라벨이 "적용 및 종료"로 박혀 있지만, 지금 구조에서는 이슈별 "수정
  저장"이 그 자리에서 바로 복제본에 반영되기 때문에 이 화면에 도달했을 때는 새로 "적용"할 게 없다 —
  전부 이미 적용된 상태. 그래서 이 버튼이 실제로 하는 일(검토를 마치고 시작 화면으로 복귀)에 맞게
  **"검토 종료"**로 이름을 바꿈. 원본은 이 리뷰 내내 한 번도 안 건드렸고 이 버튼도 원본과 무관.
- **`HistoryExportScreen.tsx`**: 클립보드 export(`buildWorkingTextPreview`, `api.exportDocument`) 전면
  제거 — 이제 복제본 컨플루언스 페이지 자체가 "내보낸 문서"라 로컬 클립보드 복사가 불필요해짐. 원본/
  수정본 토글(로컬 표시 모드 — "원본"이면 각 항목의 원문만, "수정본"이면 취소선 원문 + ✓ 수정본까지
  같이 보여줌) 추가. 검토 내역(diff-item) 클릭 시 `SCROLL_TO_ISSUE`를 컨텐츠 스크립트로 직접 보내서
  본문의 해당 하이라이트로 이동 — `IssueListScreen`이 쓰던 걸 재사용. 하단 "검토 종료" 클릭 시
  `NAVIGATE screen:'main'`으로 복귀.
- **`useIssueOverlaySync.ts`**: 오버레이 유지 조건에 `'history'` 화면도 추가 — 안 그러면 이 화면
  진입 시 하이라이트가 다 사라져서 "클릭 → 이동"이 동작할 게 없었음.
- **`appReducer.ts`**: `ISSUES_LOADED`가 `issueEdits`도 초기화하도록 수정 — 이전에는 새 QA 리뷰를
  시작해도 지난 리뷰의 수정 기록이 남아있는 버그가 있었음(이번 작업 중 발견해서 같이 고침).
- **diff 목록/토글 스타일**: Figma 실측값 그대로 — 카드 `#fafafb`/선택 시 `#faf7ff` + 오른쪽 인셋
  보라 바(`inset -3px 0 0 #c9a9ff`), 원본 텍스트 취소선 `#b4b4bc`, 수정본 `✓` 보라 + 텍스트 진회색,
  토글 트랙 `#f1f1f3` + 선택 탭 그라데이션.
- 검증: 확장 `typecheck`/`lint`/`build`/`vitest` 65개(ISSUES_LOADED 리셋 테스트 포함) 전부 통과.

### Next

- **Claude가 검증 불가능한 것**: 실제 DOC-001에서 검토 내역을 클릭하면 본문이 해당 하이라이트로
  스크롤/포커스되는지, "검토 종료" 누르면 시작 화면으로 정상 복귀하는지 확인.
- 원본/수정본 토글의 정확한 의미는 Figma가 시각적으로만 보여줄 뿐 인터랙션을 정의하지 않아서, "목록에
  원문만 보여줄지 원문+수정본을 같이 보여줄지"로 스코프를 좁혀 구현함 — 다른 의도(예: 원본 컨플루언스
  페이지로 직접 이동)였다면 다시 조정 필요.
- QA 엔진 핵심 로직 — 여전히 최우선 순위.

## 2026-08-08 — QA 엔진 코어 연결 (`sunic5-planqa/planqa-agent` review-agent 도입)

여러 세션째 "최우선 순위"로 밀려 있던 QA 엔진 코어를 드디어 붙였다. 자체 구현 대신, 별도 저장소
(`planqa-agent`, `feature/review-agent` 브랜치)에서 이미 완성돼 테스트까지 붙어있던 룰북 기반 검토
파이프라인을 가져와 벤더링했다 — 처음부터 다시 짜는 대신 검증된 걸 재사용하는 쪽으로 판단.

- **벤더링 범위**: `planqa-agent`의 `review-agent/src/planqa_review/`에서 실행 경로에 필요한 것만
  골라 `backend/src/sunnic_backend/qa_engine/review_agent/`로 복사 — `schema`/`document`/`rulebook`/
  `tiers`/`dedupe`/`instrumentation`/`verifier`/`pipeline`/`llm/{base,gemini}`/
  `models/gemini_lite/*`. CLI(`cli.py`)와 벤치마크/실험/스코어링 도구(`benchmark.py`, `experiment.py`,
  `diff_report.py`, `run_stats.py`, `scoring.py`, `llm/{factory,ollama}.py`, `openpyxl`/`python-dotenv`
  의존성)는 이 백엔드가 서빙 전용이라 제외 — 그 결과 새 의존성 추가가 하나도 필요 없었음(이미 있던
  `google-genai`로 충분). 룰북 원본(`rulebook_v1.0.md`)도 패키지 안에 함께 복사해 cwd에 의존하지
  않게 함(`Path(__file__)` 기준 경로).
  같이 딸려온 테스트 8개(`test_dedupe`/`document`/`instrumentation`/`llm_base`/`pipeline`/`screener`/
  `confirmer`/`tiers`) + trimmed `conftest.py`도 `backend/tests/qa_engine/review_agent/`로 이식,
  `document.py`의 실제 문서 회귀 테스트가 쓰는 `DOC-001` 샘플 하나만 `fixtures/`에 별도로 챙김(전체
  40개 벤치마크 문서셋은 원본 저장소에만 있음).
- **기존 반쪽짜리 `qa_engine/llm/{base,gemini}.py` 삭제**: 예전에 async `google-genai` 클라이언트로
  시작했다가 스크리너/컨펌어/파이프라인 없이 멈춰 있던 코드 — 아무 데서도 안 쓰이던 죽은 코드였고,
  review-agent 쪽 동기 클라이언트가 스크리닝→검증 로직과 이미 세트로 맞물려 있어서 그대로 대체.
- **`qa_jobs.py`**: 3개 501 스텁을 실구현으로 교체.
  - `POST /documents/{id}/qa-jobs`: `QAJob(status=running)` 저장 후 `BackgroundTasks`로 실제 검토를
    백그라운드에 태움, 응답은 즉시 `job_id`만 반환.
  - review-agent의 `GeminiClient`는 동기/블로킹(429 재시도에 `time.sleep` 사용)이라, FastAPI 이벤트
    루프를 막지 않도록 `review_document(...)` 호출 전체를 `asyncio.to_thread`로 감쌈 — review-agent
    코드 자체는 손대지 않고 격리.
  - `review_document`의 `ReviewIssue`(`rule_id`/`original_text`/`rationale`/`fix_direction` 등)를
    백엔드 `Issue` 모델(`criteria`/`input_text`/`reason`/`suggestion`)로 매핑: `criteria`는 룰북에서
    `rule_id`로 찾은 카테고리 라벨("용어 및 단어의 일관성" 등, Figma SCREEN 04 목업의 "검증기준"
    문구와 같은 형태), `reason`은 `rationale`(없으면 `description`), `suggestion`은 `fix_direction`.
    `start`/`end`는 원문에서 `input_text` 위치를 best-effort로 찾아 채움(API 응답엔 노출 안 되지만
    내부 모델 필드라 채워둠).
  - 진행률/카테고리는 이번 스코프에서 단순화 — `review_document`가 전체를 한 번에 돌려주는 구조라
    타이어별 콜백이 없음. `RUNNING(0%)` → `DONE(100%)`/`FAILED(100%)`만 보고, `current_category`는
    계속 `null`. 타이어별 실시간 진행률을 보여주려면 파이프라인 내부에 콜백 훅을 추가해야 하는데,
    이번엔 벤더링한 코드를 upstream과 최대한 diffable하게 유지하는 쪽을 택해 보류.
  - `PATCH /issues/{id}`, `GET /documents/{id}/export`는 이번 스코프 밖 — 지금 실제 편집 흐름은
    `issueOverlay.ts`가 컨플루언스 API로 직접 처리하는 복제본 저장 방식이라 이 두 엔드포인트는 애초에
    쓰이지 않음(구 "복붙 export" 시절 잔재), 그대로 501 유지.
- **`config.py`**: `qa_screen_model`/`qa_confirm_model`(둘 다 기본값 빈 문자열 → review-agent의
  `DEFAULT_MODEL`, 현재 `gemini-2.5-flash`) 추가 — 스크리닝/정밀검증에 다른 모델을 쓰고 싶을 때
  `.env`로 오버라이드 가능.
- **`pyproject.toml`**: 벤더링한 코드는 upstream과 diff 가능하게 그대로 두기 위해
  `[tool.ruff.lint.per-file-ignores]`로 `qa_engine/review_agent/**`만 `B023`/`UP047` 무시(둘 다
  `record_call`이 같은 루프 반복 안에서 람다를 즉시 실행해서 실제로는 안전한 false positive).
- **검증**: 벤더링한 39개 + 기존 17개, 백엔드 `uv run pytest` 총 56개 전부 통과. `ruff check` 클린.
  `uv run uvicorn`으로 실제 기동해 `POST /documents` → `POST .../qa-jobs` → `GET .../status` →
  `GET .../issues` 전체 왕복 수동 확인(로컬에 Gemini 키가 없어 파이프라인 자체는 곧바로
  `RuntimeError`로 실패하지만, `FAILED`/`progress:100`으로 정상 종결되고 404 케이스도 올바르게 처리되는
  것까지 확인 — 잡(job) 생명주기 배선 자체는 검증됨).

### Next

- **Claude가 검증 불가능한 것**: 실제 `GEMINI_API_KEYS`로 `.env`를 채우고 실제 컨플루언스 문서로 전체
  파이프라인이 끝까지 도는지(스크리닝→정밀검증→이슈 반환), 그리고 익스텐션 쪽 폴백 로직(`NotImplementedError`
  잡히면 fixture로 대체)이 더 이상 안 타고 실제 이슈가 표시되는지 확인 필요.
- 타이어별(문서/논리단위/문단/문장) 실시간 진행률·카테고리 — 지금은 처음부터 끝까지 `running`뿐이라
  `ProgressScreen`의 `CategoryTree`는 계속 안 뜸(옵셔널이라 깨지진 않음). 필요해지면
  `pipeline.review_document` 내부에 타이어 완료 콜백을 추가하는 방향으로 확장 가능.
  이 review-agent 코드는 별도 저장소(`planqa-agent`)에서 관리되므로, 두 저장소가 갈라지지 않게
  주기적으로 다시 동기화(재벤더링)할 필요가 있음 — 지금은 수동 재복사 방식.
- `PATCH /issues/{id}`, `GET /documents/{id}/export` — 여전히 501. 지금 실제 편집은 익스텐션이
  컨플루언스에 직접 쓰는 방식이라 당장 급하지 않지만, 이 두 엔드포인트를 아예 없앨지 다른 용도로
  바꿀지는 다음에 정리 필요.
- **QA job 엔드포인트 통합 테스트 추가(`backend/tests/test_api_qa_jobs.py`)**: `qa_jobs.GeminiClient`를
  스크립트된 페이크로 바꿔치기해서, 진짜 API 키 없이도 엔드포인트 → 백그라운드 태스크 → 실제
  review-agent 파이프라인 → `_to_issue_record` 매핑 → 저장소까지 전체 경로를 실제 코드로 검증. 이
  과정에서 `review_document`가 단계별 에러를 내부에서 흡수해 항상 `done`으로 끝난다는 걸 확인 —
  "failed"가 뜨는 유일한 경로는 파이프라인 진입 전(예: `GeminiClient` 생성 자체가 실패, API 키 없음)
  뿐이라 그 케이스로 테스트를 다시 맞춤. `criteria`가 원시 rule_id가 아니라 룰북 카테고리 라벨로 잘
  매핑되는지도 같이 검증. 4개 전부 통과, 백엔드 전체 60개로 증가.
- **실제 Gemini 키로 라이브 검증**: 사용자가 `.env`에 키 3개를 채운 뒤 직접 `review_document`를
  돌려봄 — 인증/연결 자체는 정상(에러가 401/403이 아니라 429), 다만 무료 티어 일일 한도(모델당
  하루 20건)를 세 키 다 이미 소진해 이슈가 0건으로 나옴. 문서 1건 검토에 호출이 5~9번(컨텍스트 1 +
  위계 4개 × 스크리닝/정밀검증) 들어가서 무료 키 하나로 하루 2~4건이 실질 한계 — 배선 자체는
  검증됐고 순수 쿼터 문제라 다음 UTC 리셋 이후나 새 키 추가 시 재확인.

## 2026-08-08 — 확장 아이콘 교체

기존 플레이스홀더(단색 원)를 실제 마스코트 기반 아이콘으로 교체.

- Figma에서 "Mascot icon" 라벨 아래에 있던 56×56 아이콘(보라→핑크 그라데이션 rounded square +
  흰 얼굴판 + 보라 점 눈)을 찾아 처음 적용했으나, 코너에 불투명 흰 배경이 남아있어(Figma 캔버스
  배경이 그대로 노출) 브라우저 툴바에서 흰 사각형처럼 보이는 문제가 있었음 — 이후 사용자가 코너가
  이미 투명 처리된 자체 에셋(`Desktop/Background.png`, 112×112, alpha 채널 있음)을 직접 제공해 그걸로
  최종 교체.
- `extension/public/icons/icon{16,48,128}.png`를 `sips -z`로 리사이즈해 교체. `manifest.config.ts`의
  경로 참조는 기존 그대로(변경 없음). `npm run build`로 `dist/manifest.json`과 리사이즈된 PNG들이
  정상 반영되는 것 확인.

### Next

- 실제 Chrome에 리로드해서 툴바 아이콘이 반투명 배경으로 잘 보이는지(다크 툴바 테마 포함) 확인 필요.
- QA 엔진 핵심 로직은 이제 배선/검증까지 끝났으니, 다음 최우선순위는 "여전히 최우선"에서 내려와도 됨 —
  남은 건 위 QA 엔진 섹션의 `### Next`(타이어별 진행률, 재동기화, 무료 쿼터로 인한 실사용 테스트 대기).
