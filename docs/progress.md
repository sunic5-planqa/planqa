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

## 2026-08-08 — SCREEN 02(QA 진행) 실제 반영 + 마스코트가 진행률 바 위를 걷게

사용자가 "진행 경과 시간이 흐르는데 퍼센트가 하나도 안 참"과 "SCREEN 02 UI가 실제에 반영 안 됨(그라데이션
바, 지금 어느 룰 체크 중인지)"을 각각 지적 — 둘 다 같은 근본 원인: `QAJobStatusResponse`가 처음부터
`progress=0`/`categories=None`으로 고정이었고, `review_document()`는 타이어별 콜백이 없어 통째로 끝나야만
결과가 나온다(ADR 0001에서 이미 알려진 한계). 벤더링한 파이프라인은 그대로 두고, 백엔드에서 진행률과
카테고리 체크리스트를 **경과 시간 기반으로 그럴듯하게 근사**하는 쪽으로 풀었다.

- **`backend/src/sunnic_backend/api/qa_jobs.py`**:
  - `_tick_progress`(신규): `_execute_qa_job`이 파이프라인을 `asyncio.to_thread`로 돌리는 동안 1.5초마다
    `job.progress`를 경과 시간 기반 지수함수(`90 * (1 - e^(-elapsed/45))`)로 갱신 — 실제 완료 전엔 90%를
    절대 못 넘게 해서 "아직 안 끝났는데 100%로 보임" 오인을 방지, 실제 결과가 오면 `_execute_qa_job`이
    바로 100으로 점프시킴.
  - `_categories_for_progress`(신규): 룰북의 진짜 카테고리(8개, `rulebook.rules`에서 실제로 파싱된 것)를
    `tiers.TIER_CATEGORIES`로 4개 위계(Documents/Logical Chapter/Detailed Chapter/Sentence, SCREEN 02
    그룹명과 1:1)에 묶고, 방금 그 `progress` 값을 다시 활용해 "지금 몇 번째 위계의 몇 번째 카테고리까지
    끝났다고 보여줄지"를 결정 — 진짜 완료 신호가 아니라 진행률 하나로 파생시킨 연출이라는 점을 코드
    주석에 명시.
  - `_korean_label`(신규): 룰북의 카테고리명이 "한글 설명 + 영문 Title Case"로 붙어있어(예: "용어 및
    단어의 일관성 Terminology Consistency") 정규식으로 영문 접미사를 잘라 한글만 노출 — SCREEN 02
    목업도, 기존 이슈의 `criteria` 필드도 한글만 보여주는 게 맞아서 둘 다 이걸 쓰도록 통일(이슈
    `criteria`가 지금까지 영문까지 붙어 나오던 걸 같이 고침).
  - `GET /qa-jobs/{id}/status`가 이제 `categories`/`current_category`를 실제로 채워서 반환.
- **`extension/src/components/screens/ProgressScreen.tsx`**: 진행률 바를 Figma 실측(얇은 8px 그라데이션
  필 바 + 오른쪽에 별도 `%` 라벨, 기존처럼 바 안에 텍스트 겹쳐 넣지 않음)대로 재구성. 마스코트를
  `.progress-track` 안에 절대배치해서 `left`를 `(트랙 폭 - 마스코트 폭) × progress/100`으로 계산 —
  진행률이 오를 때마다 마스코트가 바를 따라 오른쪽으로 걸어가고(`transition: left 1.4s linear`), 100%를
  넘어 트랙 밖으로 튀어나가지 않게 폭을 고정.
- **`extension/src/components/progress/CategoryTree.tsx`**: Figma 실측 반영 — `done` 항목도 라벨은
  회색(포커스는 지금 처리 중인 항목에만), `pending` 항목은 아이콘 없이 회색 텍스트만(기존엔 `○`를
  그렸었음), `in_progress` 항목만 보라 그라데이션 필(`rgba(201,169,255,.18)→rgba(255,201,232,.18)`) +
  진보라 ExtraBold 텍스트로 강조. 그룹 헤더도 지금 처리 중인 위계만 진하게, 나머지는 회색.
- **`extension/src/styles/global.css`**: `.progress-track`/`.mascot-on-track`/`.progress-bar-track`
  신규, `.progress-bar`/`.progress-bar-fill`/`.progress-bar-label`/`.category-tree`/`.category-group-
  toggle`/`.category-item*` 전면 재작성(색상·반경·패딩 전부 Figma 실측값).
- 검증: 백엔드 `_categories_for_progress`를 progress 0/10/30/50/89/100으로 수동 실행해 위계가 순서대로
  넘어가는지, `_korean_label`이 8개 카테고리 전부에서 정규식으로 올바르게 잘리는지 확인(첫 시도는
  그리디 정규식이라 영문 마지막 단어까지 남는 버그가 있었음 — non-greedy로 수정). 백엔드 60개, 확장
  `typecheck`/`lint`/`build`/`vitest` 65개 전부 통과.

### Next

- **Claude가 검증 불가능한 것**: 실제 Chrome에서 QA 진행 화면을 열어 마스코트가 실제로 바를 따라
  걷는지, 카테고리 체크리스트가 Figma와 시각적으로 맞아떨어지는지 확인 필요.
- 카테고리 체크 진행은 여전히 "진짜 신호"가 아니라 progress 값에서 파생된 연출 — 실제 문서마다 위계별
  소요 시간이 다르면(문장 위계가 챕터 수만큼 커지는 등) 근사가 어긋날 수 있음. 진짜 타이어별 콜백을
  넣으려면 결국 벤더링한 `pipeline.py`를 건드려야 해서(ADR 0001의 diffable-copy 트레이드오프) 보류.

## 2026-08-09 — SCREEN 03(QA 결과 확인) 배치 정리 + AI 제안 말풍선 안정화

사용자가 "오류 수정하기 버튼을 Figma처럼 배치"와 "AI 제안 말풍선이 어떤 이슈는 뜨고 어떤 건 안 뜸"을
같이 지적. `get_design_context`로 SCREEN 03(143:5215)를 다시 실측해서 둘 다 고쳤고, 덧붙여 "지금
오른쪽 패널에서 보고 있는 이슈의 박스"를 문서 위에서도 구분되게 그라데이션 테두리로 강조했다.

- **`오류 수정하기` 배치**: Figma는 "수정제안" 라벨과 "오류 수정하기" 링크를 10px 간격으로 나란히
  붙여둔다(카드 양 끝으로 벌어지지 않음) — `.issue-suggestion-row`가 `justify-content: space-between`
  이었던 걸 `gap: 10px`만 남기고 제거해서 고침. 색이모지 "✏️" 대신 Figma 실측 스타일(작은 원 + 연필)에
  가까운 인라인 SVG 아이콘으로 교체(`currentColor`라 링크 텍스트와 같은 검정).
- **AI 제안 말풍선이 가끔 안 뜨던 버그의 진짜 원인**: `scrollToIssue()`가 `mark.scrollIntoView({behavior:
  'smooth'})`를 건 직후 곧바로 `showTooltip()`으로 그 시점의 `getBoundingClientRect()` 좌표에 말풍선을
  꽂았음 — 스무스 스크롤 애니메이션이 끝나기 *전* 좌표라, 스크롤 거리가 크면 말풍선이 도착지가 아닌
  엉뚱한 위치(화면 밖일 수도 있음)에 떠서 사용자 눈엔 "안 뜬 것"처럼 보였다. 애니메이션 종료를 감지하는
  대신, 말풍선이 열려있는 동안 `scroll`(capture:true — 컨플루언스 내부 스크롤 컨테이너까지 잡기 위해)/
  `resize` 이벤트마다 위치를 계속 재계산하도록 바꿔서, 스무스 스크롤이 언제 끝나든 최종적으로는 항상
  mark 바로 아래에 자리잡게 함(닫힐 때 리스너 정리).
- **`extension/src/content/issueOverlay.ts`**: `ACTIVE_CLASS`(신규) — 오른쪽 패널에서 지금 보고 있는
  이슈의 mark에만 붙는 클래스. `border-image`는 `border-radius`를 무시하는 CSS 한계가 있어서, 대신
  `padding-box`(투명)/`border-box`(보라→핑크 그라데이션) 이중 `background`로 우회 — 둥근 모서리를
  유지하면서 테두리만 그라데이션. 클릭과 `scrollToIssue()` 양쪽 경로 모두 `setActiveMark()`를 거쳐서
  이전에 보던 이슈의 강조는 자동으로 빠짐.
- 검증: `issueOverlay.test.ts`에 신규 테스트 2개(active 클래스가 이슈 전환 시 정확히 옮겨가는지, mark의
  `getBoundingClientRect()`가 스크롤 도중 바뀌면 말풍선 위치도 같이 갱신되는지) 추가. 확장
  `typecheck`/`lint`/`build`/`vitest` 67개 전부 통과.

### Next

- **Claude가 검증 불가능한 것**: 실제 DOC-001에서 오른쪽 패널로 이슈를 넘길 때마다 왼쪽 박스가
  그라데이션으로 바뀌는지, 스크롤 거리가 먼 이슈로 이동해도 말풍선이 매번 정확한 위치에 뜨는지 확인.
- 오류 수정하기 아이콘은 Figma 원본 에셋(임시 URL, 7일 만료) 대신 간단한 인라인 SVG로 근사함 — 정확한
  Figma 벡터가 필요하면 나중에 `download_assets`로 실제 아이콘을 받아 교체할 수 있음.

## 2026-08-09 — 컨플루언스 헤딩 평탄화 버그 수정 + "왜 서버 결과가 CLI보다 이슈가 훨씬 많은지" 조사

사용자가 review-agent CLI로 직접 돌린 결과(`review.json`, 6개)와 우리 서버로 같은 문서를 돌린 결과(40여개)가
왜 이렇게 차이나는지 물어봄 — 두 갈래로 조사했다.

- **찾아서 고친 진짜 버그**: `extension/src/content/confluenceParser.ts`의 `htmlToChapterMarkdown`이
  컨플루언스의 h1~h6 헤딩을 전부 `##`(챕터) 한 단계로 평탄화하고 있었음 — 이건 예전 백엔드 구조 파서
  (`#`/`##` 2단계만 이해)에 맞춰 만들어진 로직인데, 지금 QA 엔진(`qa_engine/review_agent/document.py`)은
  `##`=논리 단위, `###`~`######`=그 안의 문단 경계로 계층을 나눠서 위계별 검토를 한다. 계층을 뭉개면
  원래 한 논리 단위 안에 중첩됐어야 할 소제목들이 전부 별도의 최상위 논리 단위로 갈라져 나가 검토
  대상(chunk) 수가 부풀려지고, `dedupe_issues`의 "부모 > 자식" 위치 문자열 겹침 판정도 깨진다 — **실제
  컨플루언스 문서를 검토할 때만 해당하는 버그**. `h2`→`##`, `h3`→`###`, ... 상대 깊이를 그대로 보존하도록
  수정(`h6`에서 캡, 페이지 타이틀은 계속 `#` 한 줄 전용이라 본문 h1은 `##`로 취급). 관련 테스트 갱신 +
  깊이 캡 테스트 1개 추가.
- **그런데 이게 원인의 전부가 아니었음**: 계층이 멀쩡한 로컬 `.md` 원본(vendored `DOC-001` fixture, 위
  버그와 무관)을 백엔드 파이프라인으로 직접 돌려봤더니 그래도 **44개**가 나옴 — 완전히 같은 문서·룰북인데
  CLI의 6개와 여전히 큰 차이. 로그를 까보니 44개 중 23개가 전부 Paragraph 위계의 "MI"(정보 누락)
  카테고리로, `6-1`~`6-5` 서브섹션마다 거의 기계적으로 반복 검출됨.
  - **추정 원인**: review-agent는 원래 "저비용 모델이 과하게 flag(스크리닝, 설계상 의도된 동작) →
    고비용/정밀 모델이 그중 진짜만 확정(정밀검증)"하는 2단계 구조인데, 우리 백엔드는 `qa_screen_model`/
    `qa_confirm_model` 둘 다 기본값이 같은 `gemini-2.5-flash`라 정밀검증 단계가 스크리닝만큼 약해서
    over-flag를 거의 그대로 통과시키고 있는 것으로 보임. CLI 쪽(`review.json`)은 `--verify-model`에 더
    강한 모델을 지정했을 가능성이 높음.
  - **확실히 검증은 못 함** — 오늘 무료 쿼터를 이 조사로 상당히 써서 재검증이 어려웠음. `.env`에
    `QA_CONFIRM_MODEL=gemini-2.5-pro`(또는 더 강한 모델)를 지정해서 같은 문서로 다시 돌려보면
    확인 가능 — 다음 세션 쿼터 리셋 후 시도할 것.
- 검증: 확장 `typecheck`/`lint`/`build`/`vitest` 68개 전부 통과.

### Next

- **최우선**: `QA_CONFIRM_MODEL`을 정밀 모델로 바꿔서 같은 DOC-001 fixture로 재검토했을 때 이슈 수가
  CLI의 6개에 가까워지는지 확인 — 이게 맞다면 `.env.example`에도 기본 정밀검증 모델 권장값을 남겨야 함.
  아니라면(그래도 여전히 많이 나온다면) 스크리닝 자체가 과도하거나, confirm 프롬프트/파싱에 별도
  문제가 있는지 더 파봐야 함.
- 컨플루언스 헤딩 평탄화 수정은 실사용(실제 DOC-001)에서 논리 단위/문단 구조가 원문 그대로 나오는지
  확인 필요 — Claude가 검증 불가능.

## 2026-08-09 — 하이라이트 프레임 유형(`frame_type`) 배선

사용자가 공유한 "Ver.2 - Edit 행위별 프레임 유형 구분" 설계 문서를 기준으로, 문서 위 하이라이트 박스를
QA 기준에 따라 다르게 그리는 첫 단계(백엔드 배선)를 진행했다. 전체 매트릭스(QA 기준 8개 × Edit 행위
4개)를 뜯어보니 실제로 행위 분류가 필요한 건 LG/LF/GA 3개뿐이라는 걸 확인 — TC/TM/AE/RD는 허용 행위가
Replace/Delete뿐이라 항상 객체 프레임, MI는 Insert뿐이라 항상 삽입범위 프레임, rule_id 카테고리만으로
결정 가능했다.

- **막힌 지점**: LG/LF/GA는 두 위치 간 관계 오류(예: "2-2가 2-1과 다르다")라 범위 프레임을 그리려면
  두 번째 위치가 필요한데, review-agent의 `Issue` 스키마엔 `location` 하나뿐이라 지금은 만들 수 없음
  — `related_location: str | None` 필드 추가를 요청하는 이슈를 올림:
  [sunic5-planqa/planqa-agent#4](https://github.com/sunic5-planqa/planqa-agent/issues/4).
- **`backend/src/sunnic_backend/models/issue.py`**: `FrameType` StrEnum(`object`/`range`/`insert_range`)
  추가, `Issue`에 `frame_type`(기본값 `object`)/`related_location` 필드 추가.
- **`backend/src/sunnic_backend/api/qa_jobs.py`**: `_frame_type(category, related_location)` — MI는
  무조건 `insert_range`, LG/LF/GA는 `related_location`이 있을 때만 `range`(없으면 `object`로 안전하게
  폴백), 나머지는 `object`. `_to_issue_record`가 `getattr(issue, "related_location", None)`으로
  값을 읽음 — 벤더링한 `schema.py`에 아직 그 필드가 없어도 에러 없이 `None`으로 폴백하고, 원작자가
  필드를 추가해서 재벤더링하면 **코드 변경 없이 자동으로 채워지는 구조**로 만들어둠. `IssueResponse`에도
  두 필드 추가해서 API로 노출.
- **`extension/src/api/types.ts`**: `IssueResponse`에 `frame_type`/`related_location` 타입만 동기화 —
  **실제로 문서 DOM에서 범위/삽입범위 모양대로 박스를 그리는 로직(`issueOverlay.ts`)은 아직 구현 안 함**,
  지금은 백엔드가 값을 내려주기 시작한 것뿐. 기존 fixture(`fixtures.ts`)/데모 이슈(`demoIssues.ts`)/
  테스트 헬퍼(`issueGrouping.test.ts`)도 새 필수 필드 때문에 타입 에러 나서 같이 채워넣음.
- 검증: 백엔드 `_frame_type` 매핑 12개 케이스 파라미터라이즈 테스트 추가, 전체 72개 통과, ruff 클린.
  확장 `typecheck`/`lint`/`build`/`vitest` 68개 전부 통과.

### Next

- `issueOverlay.ts`에 `insert_range`(위치의 상위 위계 헤딩 구간 전체를 감싸기)와 `range`(location~
  related_location 두 헤딩 사이 전체를 감싸기) 렌더링 로직 추가 — 지금은 `frame_type`이 뭐든 항상
  기존 object 방식(정확한 텍스트 매칭)으로만 그려짐. 헤딩 텍스트로 DOM 위치를 찾는 유틸이 새로 필요함.
- `related_location`은 원작자가 이슈(#4)를 반영해줘야 실제 값이 들어옴 — 그 전까지 LG/LF/GA는 계속
  object로 폴백.

## 2026-08-09 — 수정 시 왼쪽 문서 덮어쓰기 + 백엔드 문장 유사도 검사

"수정 저장" 흐름에 두 가지를 추가했다: (1) 저장 성공 시 왼쪽 문서 화면에서도 실제로 텍스트가 바뀐 것처럼
보이게, (2) AI 제안과 많이 다른 내용으로 저장하려 하면 백엔드가 유사도를 계산해 경고하고, "수정 저장"을
한 번 더 눌러야 그대로 반영되게.

- **왼쪽 문서 덮어쓰기 (`issueOverlay.ts`)**: 지금까지 저장 성공해도 하이라이트 테두리만 초록색으로
  바뀔 뿐 화면엔 여전히 고치기 전 원문이 남아있었음(실제 쓰기 대상은 복제본이라 지금 보고 있는 원본
  탭은 안 바뀌니까) — 사용자가 "진짜 저장됐나?" 헷갈릴 수 있어서, 성공 시 `overwriteMarkText()`로
  mark의 `textContent`를 새 텍스트로 직접 덮어쓴다. 여러 엘리먼트에 걸친 매치(라벨+뱃지 등)는 새
  텍스트를 정확히 나눠 넣을 방법이 없어 첫 mark로 합치고 나머지는 제거 — 기존 "여러 mark를 각각
  resolved 처리" 테스트를 "하나로 합쳐지고 새 텍스트를 보여준다"는 검증으로 다시 씀.
- **`backend/src/sunnic_backend/api/issues.py`**: `POST /issues/similarity-check` 신규 —
  `difflib.SequenceMatcher`(표준 라이브러리, 외부 API 호출/쿼터 소모 없음)로 AI 제안과 사람이 실제
  고친 텍스트의 문자열 유사도를 계산해 `{similarity, matches_closely}` 반환. 임계값은 기존 프론트
  로컬 Levenshtein 체크와 같은 0.3 유지 — 체감 동작이 바뀌지 않게.
- **`extension/src/state/editValidation.ts`**: 유사도 판단을 백엔드로 옮기면서, 여기 남은 건 네트워크
  없이 즉시 되는 로컬 체크(수정한 텍스트에 원래 문제 문구가 아직 남아있는지, `isIssueLikelyResolved`)
  뿐 — 기존 `similarityRatio`/Levenshtein 구현은 제거(더 이상 두 곳에서 서로 다른 유사도를 계산하는
  걸 피하려고 백엔드를 유일한 판단 주체로 함).
- **`extension/src/components/screens/IssueListScreen.tsx`**: `handleSaveClick`을 async로 변경 —
  처음 누르면 (1) 로컬 `isIssueLikelyResolved` 체크 → (2) 통과하면 백엔드
  `api.checkEditSimilarity()` 호출. 둘 중 하나라도 걸리면 저장 안 하고 경고 문구만 띄운 뒤 리턴,
  버튼 라벨은 확인 중엔 "확인 중...". 이미 경고를 본 상태(`warningAcknowledged`)에서 다시 누르면
  재검사 없이 바로 저장 — "한 번 더 누르면 반영" 요구사항 그대로. 백엔드 호출 자체가 실패해도(네트워크
  등) 저장은 막지 않음 — 유사도 검사는 안전장치일 뿐 필수 게이트가 아니라고 판단.
- 검증: 백엔드 유사도 엔드포인트 테스트 3개(동일 텍스트/전혀 다른 텍스트/사소한 수정 각각) 추가,
  전체 75개 통과. 확장 `editValidation.test.ts` 재작성 + `issueOverlay.test.ts` 신규 2개(단일/다중
  엘리먼트 덮어쓰기) 포함 63개, `typecheck`/`lint`/`build` 전부 통과.

### Next

- **Claude가 검증 불가능한 것**: 실제 DOC-001에서 수정 저장 후 왼쪽 문서에 새 텍스트가 바로 보이는지,
  AI 제안과 많이 다른 내용을 입력했을 때 경고가 뜨고 한 번 더 눌러야 저장되는지 확인.
- 유사도 검사가 문자열 기반(difflib)이라 의미는 같지만 표현이 많이 다른 수정(동의어 교체 등)은
  경고가 뜰 수 있음 — 안전장치로 설계했으므로 오탐이 있어도 사용자가 한 번 더 누르면 그냥 진행되는
  구조라 크게 문제는 아니지만, 필요하면 나중에 임베딩 기반 의미 유사도로 교체 고려 가능.

## 2026-08-10 — review-agent를 `planqa-agent`의 `dev` 브랜치로 재벤더링

사용자가 `sunic5-planqa/planqa-agent`의 `dev` 브랜치로 다시 연결해달라고 요청 — 확인해보니 우리가
처음 벤더링한 `feature/review-agent` 이후 원작자가 `dev`에서 상당히 진척시켜 놨었다(PR #5~#12).
가장 중요한 건: **우리가 이슈로 요청했던 `related_location` 필드(sunic5-planqa/planqa-agent#4)가
실제로 반영됐고**, 검토 위계 4개가 이제 순차가 아니라 **병렬**로 돈다.

- **저장소 구조 변경**: `schema.py`/`rulebook.py`가 별도 `packages/planqa-schemas` 패키지로 분리됐고,
  `review-agent` 본체는 `services/review-agent`로 이동. 새로 생긴 `structures/category_screen.py`가
  기존 profile 기반 `pipeline.review_document(..., profile)`을 대체하는 새 진입점 — 우리도 이걸로
  갈아탐. 스크리닝이 이제 룰 텍스트가 아니라 카테고리 라벨만 보고, 정밀검증 단계에서 그 카테고리의
  룰 전체 중 구체적 `rule_id`를 직접 고르는 구조로 바뀌었다.
- **`backend/src/sunnic_backend/qa_engine/review_agent/`**: `models/`(구 profile 기반 스크리너/
  컨펌어) 전체 삭제, `planqa_schemas/`(신규, schema.py/rulebook.py) 추가, `structures/
  category_screen.py`(신규) 추가, `document.py`/`dedupe.py`/`instrumentation.py`/`tiers.py`/
  `verifier.py`/`pipeline.py`/`llm/{base,gemini}.py` 전부 최신으로 교체(import 경로만 재작성).
  `pipeline.py`는 `review_document` 함수 자체는 이제 안 쓰지만 `ReviewResult` dataclass를 계속
  가져다 쓰므로 그대로 유지.
- **`TIER_CATEGORIES`가 원작자 쪽에서 고쳐져 있었음** — 우리가 처음 벤더링했던 버전은 위계별 카테고리
  배정이 상당히 빠져있었다(예: Document 위계에 TC/TM이 아예 없었음). 재벤더링으로 자동 수정됨 —
  우리 쪽에서 발견할 수 있는 종류의 문제가 아니었음.
- **`clone()` 호환성 문제 발견 및 수정**: `LLMClient`에 새로 생긴 `clone(*, tier=...)`(병렬 실행 시
  위계별로 독립된 클라이언트를 쓰기 위함)의 기본 구현이 생성자에 명시적으로 넘긴 `api_keys`를 재사용하지
  않고 `os.environ`에서 다시 읽음 — 이 백엔드는 `.env`를 pydantic-settings로만 읽고 프로세스
  환경변수에는 안 심어서, 그대로 두면 병렬 실행되는 모든 clone이 "키 없음" 에러로 죽는다. 처음엔
  `os.environ.setdefault(...)`로 채워보려 했으나 **프로세스 전역 상태라 테스트 간에 오염되는 부작용을
  직접 발견**(`test_config.py`의 "기본값은 빈 리스트" 테스트가 다른 테스트가 심어둔 env var 때문에
  깨짐) — 대신 `qa_jobs.py`에 로컬 서브클래스(`_ScopedClient`)를 두어 `clone()`이 명시적 키를 그대로
  물려주도록 오버라이드(벤더링 파일 자체는 안 건드림).
- **`backend/tests/test_api_qa_jobs.py`의 `FakeGeminiClient`**: 새 프롬프트 형태(스크리닝은
  `category`만, 정밀검증이 `rule_id`를 직접 지정)에 맞게 정규식/응답 갱신, `clone()` 메서드 추가.
- **테스트 재벤더링**: `test_confirmer.py`/`test_screener.py`/`test_pipeline.py`(전부 구 profile
  경로 대상) 삭제, `test_document.py`/`test_dedupe.py`(related_location 관련 케이스 추가)/
  `test_instrumentation.py`/`test_llm_base.py`/`test_tiers.py`(고쳐진 카테고리 반영)/
  `test_category_screen.py`(신규) + `conftest.py`(clone 지원 `ScriptedLLM`) 갱신, `source_dir`
  픽스처는 기존처럼 로컬 `fixtures/`(DOC-001만)로 유지.
- **실제 Gemini 키로 라이브 검증**: `DOC-001` fixture로 `_run_review_sync` 직접 실행 —
  22개 이슈, `tier_errors` 없음, LG/LF/GA 이슈에 `related_location`이 실제로 채워지는 것 확인
  (예: "5. 고려되는 대안"의 LG-05가 "4. 기술적 제약 사항"과 관계있다고 정확히 짚어냄). 재벤더링
  전 같은 문서·모델로 44개가 나왔던 것과 비교하면 훨씬 정상적인 수치 — 카테고리 기반 스크리닝과
  고쳐진 `TIER_CATEGORIES` 둘 다 원인일 수 있음(2026-08-09 조사에서 완전히 못 밝혔던 부분과 연결).
  소요시간 88.8초(대부분 무료 티어 429 재시도 대기로 추정, 병렬화 자체의 체감 효과는 이번 한 번의
  실행만으로는 정확히 분리 측정 못함).
- 검증: 백엔드 72개 전부 통과(재벤더링한 테스트 포함), ruff 클린. 확장 쪽은 API 응답 필드(`frame_type`/
  `related_location`)가 이미 타입에 있어서 변경 없음 — `related_location`이 실제로 채워지기 시작한
  것뿐이라 프론트가 그 값을 실제로 활용(범위 프레임 렌더링)하는 건 여전히 다음 단계.

### Next

- **최우선**: `issueOverlay.ts`에 실제 `range`/`insert_range` 렌더링 로직 — 이제 `related_location`이
  진짜 값으로 채워지니 헤딩 텍스트로 두 지점을 찾아 그 사이를 감싸는 로직을 구현할 수 있는 상태가 됨.
- **Claude가 검증 불가능한 것**: 실제 DOC-001에서 다시 QA를 돌렸을 때 병렬 실행이 체감상 더 빠른지,
  LG/LF/GA 이슈가 실제 컨플루언스 문서에서도 안정적으로 related_location을 잡아내는지 확인.
- 6개(CLI) vs 44개(재벤더링 전 서버) 차이가 왜 났는지는 여전히 완전히 설명 못함 — 22개로 줄어든 게
  좋은 신호이긴 하지만, 더 정밀한 모델(현재는 Claude Sonnet, 아래 항목 참고)로 재검증하는 것도
  여전히 유효한 다음 실험.
- 원작자 쪽 저장소가 앞으로도 계속 바뀔 수 있으니, 다음에 다시 크게 벌어지면 또 재벤더링 필요 — 지금은
  수동 재복사 방식 그대로(ADR 0001 업데이트에 기록).

## 2026-08-10 — QA 엔진을 Gemini에서 Claude(Haiku 스크리닝 → Sonnet 정밀검증)로 전환

사용자가 병렬 실행은 유지하면서 모델을 Claude API로 바꿔달라고 요청 — 1차 스크리닝은 Haiku, 2차
정밀검증은 Sonnet. 마침 `config.py`엔 2026-08-04부터 `anthropic_api_key`/`sunnic_haiku_model`/
`sunnic_sonnet_model` 설정이 이미 있었음(그때는 안 쓰이고 있었을 뿐) — 바로 연결하면 됐다.

- **`llm/anthropic.py`(신규 벤더링)**: `planqa-agent` dev의 `AnthropicClient` — 동기 클라이언트,
  429/5xx/연결오류 재시도, `claude-sonnet-5`는 `temperature` 파라미터 자체를 거부해서 모델별로
  조건 분기, extended thinking은 고정 스키마 JSON 작업엔 불필요(레이턴시 10배 될 수 있음)해서
  명시적으로 꺼둠(`thinking: {type: "disabled"}`), 응답에 `ThinkingBlock`이 먼저 와도 첫 번째
  text 블록을 찾아 파싱. 테스트 11개(재시도/온도 조건분기/thinking 블록 스킵 등)도 같이 벤더링.
- **`qa_jobs.py`**: `GeminiClient` → `AnthropicClient`로 교체. `_ScopedClient`(clone() 시 명시적
  키를 다시 물려주는 로컬 서브클래스, Gemini 때와 동일한 이유)도 `api_keys`(리스트) 대신
  `api_key`(단일 문자열)로 맞춤. `screen_llm`은 `settings.sunnic_haiku_model`, `confirm_llm`은
  `settings.sunnic_sonnet_model` — 새 설정 추가 없이 기존 필드 그대로 사용.
- **`config.py`**: 이제 안 쓰는 Gemini 전용 오버라이드 `qa_screen_model`/`qa_confirm_model` 제거
  (같은 역할을 처음부터 하던 `sunnic_haiku_model`/`sunnic_sonnet_model`과 중복이라 정리). `gemini_
  api_keys`와 벤더링된 `llm/gemini.py`는 그대로 남겨둠(당장 안 쓰지만 나중에 다시 필요할 수 있어
  제거는 안 함) — 다만 `qa_jobs.py`에서 더 이상 import 안 됨.
- 검증: 백엔드 83개 전부 통과(신규 Anthropic 클라이언트 테스트 11개 포함), ruff 클린
  (`C408`도 벤더링 예외 목록에 추가 — 벤더링 코드를 upstream과 다르게 리팩터링하지 않기 위해,
  기존 B023/UP047과 같은 이유).

### Next

- **Claude가 검증 불가능한 것**: `.env`에 `ANTHROPIC_API_KEY`가 아직 비어있어서 실제 호출 검증을
  못 함 — 채운 뒤 DOC-001로 다시 돌려서 (1) Haiku/Sonnet 조합이 실제로 동작하는지, (2) 이슈 수가
  Gemini 조합(22개) 대비 어떻게 달라지는지, (3) `sunnic_haiku_model` 기본값("claude-haiku-4-5")이
  실제 Anthropic API가 받는 정확한 모델 ID가 맞는지(날짜 붙은 정식 ID가 필요할 수도 있음) 확인 필요.
- SCREEN 02의 진행률 카테고리 체크리스트(`_categories_for_progress`)는 여전히 "위계가 순차로 끝난다"고
  가정하고 만들어짐 — 지금은 Gemini든 Claude든 4개 위계가 실제로는 병렬 실행이라 이 가정이 실제와
  어긋나 있음(사용자가 직접 지적). 아직 안 고침 — 다음 우선순위.

## 2026-08-10 — 진행률 체크리스트를 병렬 실행에 맞게 수정

바로 위 Next 항목 — `_categories_for_progress`가 "Documents 다 끝나고 → Logical Chapter → ..."
순서로 하나씩 차오른다고 가정하고 있었는데, `category_screen.review_document()`는 4개 위계를
동시에 돌리니 실제로는 다 같이 진행되다가 다 같이 끝난다. 사용자가 지적한 그대로 고쳤다.

- **`backend/src/sunnic_backend/api/qa_jobs.py`**: `tier_index`/`band` 기반의 순차 워크스루 로직을
  제거하고, 모든 그룹이 같은 `fraction = progress / 100`으로 동시에 차오르도록 변경 — 그룹 4개가
  전부 비슷한 속도로 진행되다가 100%에서 다 같이 완료 처리됨. `current_category`는 그중 맨 처음
  발견한 "진행 중" 항목 하나를 대표로 반환(여러 그룹이 동시에 in_progress 상태를 가질 수 있어서).
- 프론트(`CategoryTree.tsx`)는 그룹별로 독립적으로 "이 그룹에 in_progress 항목이 있으면 진하게"
  판단하는 로직이라 코드 변경 없이 자동으로 4개 그룹이 동시에 강조되게 됨.
- 검증: 신규 테스트 2개(모든 그룹이 비슷한 속도로 진행되는지, 100%에서 전부 done인지) 추가, 백엔드
  85개 전부 통과. `progress=0/30/50/89/100`으로 수동 실행해 4개 그룹이 실제로 같이 움직이는 것 확인.
  확장 `typecheck`/`lint`/`build`/`vitest` 63개(변경 없음, 프론트 코드는 안 건드림) 전부 통과.

### Next

- **Claude가 검증 불가능한 것**: 실제 Chrome에서 QA 진행 화면을 열어 4개 그룹이 실제로 동시에
  체크되는 것처럼 보이는지 확인.

## 2026-08-10 — failed job이 "이슈 없음"으로 오인되던 버그 수정 + Claude 조합 실검증

사용자가 실서버에서 QA를 돌렸는데 "발견된 이슈가 없습니다"만 뜬다고 보고 — 확인해보니
`ANTHROPIC_API_KEY`가 비어있어 job이 시작하자마자 실패(`failed`)하고 있었는데, 폴링 로직이
`failed`를 `done`과 똑같이 취급해서 그냥 빈 이슈 목록을 불러오고 있었다. 실제로는 "검토 자체가
실패"인데 화면엔 "문제 없음"처럼 보이는 게 진짜 버그라 같이 고쳤다.

- **`extension/src/hooks/useQAJobPolling.ts`**: `status === 'failed'`일 때 더 이상 `ISSUES_LOADED`로
  넘어가지 않고, `SET_ERROR`로 명확한 에러 메시지("QA 검토가 실패했습니다. 서버의 API 키 설정을
  확인해주세요.")를 띄우도록 분리 — `App.tsx`에 이미 있던 전역 `ErrorBanner`가 자동으로 뜬다(새
  컴포넌트 필요 없었음). `done`일 때만 기존처럼 이슈 목록을 불러옴.
- **`.env` 정리**: `ANTHROPIC_API_KEY` 줄이 중복(빈 값 하나 + 실제 키 하나)으로 들어가 있어서 빈
  줄 제거.
- **실제 Claude(Haiku→Sonnet) 조합으로 DOC-001 검증**: 66.1초, **12개 이슈** — Gemini 조합(22개)
  보다 훨씬 적고 CLI 기준(6개)에 더 가까워짐, Sonnet 정밀검증이 더 엄격하게 거른다는 가설과 일치.
  `tier_errors` 1건(Paragraph 위계에서 Claude가 malformed JSON 응답 — 파이프라인이 그 위계만
  격리하고 나머지 3개 위계는 정상 진행, 설계대로 동작한 것이지 버그 아님) 확인.
- 검증: 확장 `typecheck`/`lint`/`build`/`vitest` 63개 전부 통과(신규 테스트는 안 붙임 — 이 훅은
  기존에도 전용 테스트 파일이 없던 컨벤션 유지).

### Next

- **여전히 남은 조사**: 6개(CLI) vs 12개(Claude 서버) 차이가 여전히 존재 — 헤딩 평탄화 버그도 고쳤고
  모델도 Sonnet으로 정밀화했는데 아직 2배 차이. 문서 자체(fixture DOC-001)와 CLI 실행 당시 정확히
  같은 조건이었는지(모델/프롬프트 버전 등) 재확인이 다음 단계로 남음.
- Paragraph 위계의 malformed JSON 이슈가 반복되면 Claude 쪽 응답 파싱(`parse_json_response`)이나
  프롬프트 쪽에 더 견고한 처리가 필요할 수 있음 — 지금은 1회성이라 관찰만.

## 2026-08-10 — PR #15 `/code-review` 결과 반영

머지 전 `/code-review`를 돌려서 8개 지적 발견. 그중 우리 코드(`qa_jobs.py`)에 해당하는 진짜 버그
1개만 고치고, 나머지 6개는 전부 벤더링해온 파일(`review_agent/**`, ADR 0001 정책상 upstream과
diffable하게 그대로 두기로 한 영역) 안의 지적이라 로컬에서 고치지 않기로 판단 — 대신 upstream에
알려야 할 사안인지는 별도 검토.

- **고침**: `_ScopedClient.clone()`(qa_jobs.py)이 원본 인스턴스의 `temperature`/`max_tokens`를 안
  물려주고 매번 기본값으로 리셋되던 버그 — 지금 당장은 둘 다 항상 기본값이라 실제 동작에 영향 없었지만,
  나중에 `max_tokens`를 조정하면 병렬 실행되는 clone들만 조용히 무시하게 될 뻔했음. 테스트 더블
  `FakeAnthropicClient`도 `_temperature`/`_max_tokens` 속성을 갖도록 맞춤.
- **판단 보류(벤더링 정책)**: `pipeline.review_document()`가 이제 죽은 코드라는 지적, `category_screen.py`의
  category/rule_id 매칭이 완전일치라는 지적, 벤더링한 테스트 파일들의 docstring/순환 검증 등 — 전부
  `review_agent/**` 안의 upstream 코드라 로컬에서 고치지 않음. `pipeline.review_document()` 건은
  실제로 유효한 지적이라 `sunic5-planqa/planqa-agent`에 이슈로 알릴지 다음에 검토.
- 검증: 백엔드 85개 전부 통과, ruff 클린. 확장 63개 전부 통과.

## 2026-08-10 — 수정 저장이 "원문에서 해당 문구를 찾지 못했습니다"로 실패하던 버그 수정

사용자가 실제로 "수정 저장"을 눌렀는데 이 에러가 뜬다고 보고. 원인은 라이브 DOM에서 이슈 위치를
찾을 때는(2026-08-06에 이미 고친 것처럼) 공백 차이에 관대한 정규식(`buildLooseTextRegex`)을 쓰는데,
**컨플루언스에 실제로 저장하는 단계(`replaceTextAndSave`)는 여전히 완전 일치(`html.includes`)만
체크**하고 있었던 것 — 컨플루언스 storage HTML의 줄바꿈/공백이 화면에 렌더링된 것과 완전히 같지
않은 경우가 흔해서, 화면엔 분명히 보이는 문구인데 저장 단계에서만 못 찾는 비대칭이 있었다.

- **`extension/src/content/issueOverlay.ts`**: `replaceTextAndSave`가 이제 `html.includes(oldText)`
  대신 `buildLooseTextRegex(oldText)`로 storage HTML을 검색 — 매치 위치를 찾아 `slice`로 직접
  이어붙여 치환(문자열 `.replace()`의 `$&`/`$1` 같은 특수 치환 패턴 해석 위험도 같이 피함). 표/목록처럼
  문구 중간에 인라인 태그가 끼어드는 경우는 여전히 못 잡음 — 알려진 한계로 남김.
- 검증: 신규 테스트 1개(storage HTML의 공백이 다를 때도 저장에 성공하고, 실제 PUT 바디가 정확히
  치환됐는지) 추가. 확장 `typecheck`/`lint`/`build`/`vitest` 64개 전부 통과.

### Next

- **Claude가 검증 불가능한 것**: 실제 DOC-001에서 이번에 "수정 저장"이 정상적으로 성공하는지 확인.
- 인라인 서식(볼드/링크 등)이 문구 중간에 끼어드는 경우의 저장 실패는 여전히 미해결 — 필요해지면
  storage HTML을 파싱해서 태그를 건너뛰는 매칭까지 확장을 고려할 수 있음.

## 2026-08-10 — 위 수정으로도 여전히 실패하던 케이스 추가 수정 (목록 항목에 걸친 문구)

실제 DOC-001 페이지에서 검증했더니 위 공백-관대 매칭 수정으로도 여전히 같은 에러가 재현됨. 원인은
이번엔 공백이 아니라 **완전히 다른 종류의 비대칭**이었다 — 이슈의 `input_text`가 "홈 UV
(Unique Visitor) 월 2만명 달성" + "근거: 구매 전환율..."처럼 **서로 다른 두 `<li>` 항목의 텍스트가
공백 하나 없이 이어붙은 것**이었음. 라이브 DOM에서 이슈를 찾는 `wrapIssue`/`collectTextSpans`는
애초에 텍스트 노드를 구분자 없이 그냥 이어붙여서 이런 경우도 잡아내는데(라벨+뱃지 케이스와 같은
이유), storage HTML 쪽은 문자열 하나로만 검색했기 때문에 실제 문서에 `</li><li>` 태그가 끼어있으면
(공백조차 없어서) `buildLooseTextRegex`로도 못 찾았다.

- **`extension/src/content/issueOverlay.ts`**: `replaceInStorageHtml`을 2단계로 분리 —
  1) 기존처럼 단순 느슨한 정규식으로 원본 문자열 그대로 찾기(되면 나머지 마크업을 전혀 안 건드리는
  가장 안전한 경로), 2) 그걸로 못 찾으면 `replaceAcrossElements`로 폴백 — storage HTML을
  `DOMParser`로 파싱해 `collectPlainTextSpans`로 텍스트 노드를 이어붙인 뒤(라이브 DOM의
  `collectTextSpans`와 같은 방식) 매치 구간에 걸리는 노드들을 원본 문자열 안에서 각각 다시
  찾아(`indexOf`) 그 부분만 문자열 스플라이스로 치환. 파싱한 트리를 통째로 re-serialize하지 않는
  이유는 매크로 등 나머지 마크업이 미묘하게 바뀔 위험을 피하기 위함 — 매치 안 걸리는 부분은 원본
  문자열을 그대로 복사.
- 검증: 신규 테스트 1개(공백 없이 이어붙은 두 `<li>` 항목에 걸친 문구를 찾아 첫 항목엔 치환문을
  넣고 나머지는 비우는지) 추가, 기존 22개 포함 전부 통과. 확장 `typecheck`/`lint`/`build`/
  `vitest` 65개 전부 통과.

### Next

- **Claude가 검증 불가능한 것**: 실제 DOC-001에서 이번엔 "수정 저장"이 성공하는지 재확인(브라우저에서
  확장 리로드 필요).
- 인라인 서식(볼드/링크 등)처럼 매치 구간 자체가 아니라 그 *안쪽*에 태그가 끼어드는 경우는 여전히
  다루지 않음 — `collectPlainTextSpans`가 텍스트 노드 단위로만 자르기 때문에, 지금 폴백은 "완전히
  분리된 여러 노드에 걸친 문구"까지만 커버하고 "한 문구 중간에 서식 태그가 끼어든" 경우는 다음 문제.

## 2026-08-10 — 위 수정을 실제 DOC-001 원문 구조로 재검증

사용자가 리로드 후 다시 테스트했는데도 여전히 같은 에러가 재현된다고 보고. 원인을 추측만 하지 않고
Atlassian 연동으로 실제 페이지(`gy30356635.atlassian.net`, pageId 229548) 원문을 직접 조회해서
확인함 — 문제의 문구는 예상했던 "서로 다른 두 `<li>`"가 아니라, **하나의 `<p>` 안에서
`<strong>...</strong>` 볼드 태그와 `<br>` 줄바꿈을 사이에 두고 이어진 문구**였다:
`<li><p><strong>홈 UV (Unique Visitor) 월 2만명 달성</strong><br>근거: 구매 전환율...</p></li>`.

바로 직전 세션에서 "인라인 서식이 문구 중간에 끼어드는 경우는 범위 밖"이라고 남겨뒀던 한계 사례가
실제로 이거였는데, 다시 짚어보니 `collectPlainTextSpans`는 텍스트 노드를 태그 종류와 무관하게(블록
경계든 인라인 경계든) 그냥 순서대로 이어붙이기 때문에 — 실제로는 이미 이 케이스도 처리될 것으로
보였음. 실제 원문 구조를 그대로 복제한 격리 테스트를 먼저 돌려 확인: **통과**. 이후 이 재현 케이스를
정식 회귀 테스트로 `issueOverlay.test.ts`에 추가.

- **결론**: 로직 자체는 이미 이 케이스를 정확히 처리한다(`<strong>`/`<br>` 태그는 그대로 두고 그
  사이 텍스트 노드 내용만 치환됨을 테스트로 확인). 여전히 실패했다면 가장 유력한 원인은 사용자가
  테스트한 시점에 확장이 최신 빌드로 리로드되지 않았을 가능성 — 코드 쪽에서 새로 발견된 버그는 없음.
- 검증: 실제 원문 구조를 그대로 옮긴 신규 테스트 1개 추가, 확장 66개 전부 통과, lint/build 클린.

### Next

- 사용자가 **정확히 이 빌드**(`ca8d702` 이후, 방금 커밋)로 리로드했는지 재확인 후 재시도 필요 —
  `chrome://extensions` 리로드 + 컨플루언스 탭 새로고침까지 포함해서.
- 그래도 실패하면 다음 의심 지점: 실제 storage HTML이 이번에 조회한 "HTML+" 표현과 미묘하게 다른
  직렬화(예: 상태 뱃지가 `<ac:structured-macro>`)일 가능성 — 그땐 REST API로 진짜 `body.storage`
  원문을 직접 떠서 비교해봐야 함.

## 2026-08-10 — 진짜 원인 확정: HTML 엔티티(`&rarr;`) 때문에 못 찾던 것 + 매칭 방식 재설계

리로드 후에도 재현돼서, 실패 시 실제 원본 조각을 콘솔에 남기는 진단 로그(`logStorageMatchFailure`)를
추가해 사용자에게 받아봄. 실제 storage HTML:

```
<strong>홈 UV (Unique Visitor) 월 2만명 달성</strong><br />근거: ... 홈&rarr;장바구니 이탈율 95% ...
```

"→"가 리터럴 문자가 아니라 **`&rarr;` HTML 엔티티**로 저장돼 있었음. 어제 짠 `replaceAcrossElements`는
"DOMParser로 디코딩한 텍스트 노드 내용을 원본 문자열 안에서 다시 `indexOf`로 찾는" 방식이었는데,
디코딩된 텍스트엔 "→"(1글자)가 있고 원본엔 "&rarr;"(6글자)만 있으니 애초에 원본 안에 존재하지 않는
문자열을 찾으려던 셈 — 항상 실패할 수밖에 없었다. 격리 테스트가 이걸 못 잡은 이유는 테스트 픽스처에
엔티티 없이 리터럴 "→"를 그대로 넣었기 때문(재현 실패의 재현 실패).

- **근본적으로 다시 짬**: "디코딩 후 원본에서 다시 찾기"(indexOf 기반) 자체를 버리고, storage HTML을
  한 번만 훑으면서 태그는 건너뛰고 엔티티는 `<textarea>.innerHTML → .value` 트릭으로 디코딩하되, 디코딩된
  글자 하나하나가 원본의 어느 바이트 구간이었는지 그 자리에서 같이 기록(`decodeStorageHtmlText`)하는
  방식으로 교체. 매칭도 이 디코딩된 텍스트 기준으로 하고, 매치 구간을 raw 오프셋으로 바로 역산하므로
  "다시 찾다가 못 찾는" 실패 모드 자체가 사라진다(named entity가 몇 개든 상관없이 동작).
  - 단, 매치 구간을 무작정 통째로 잘라내고 newText로 바꾸면 `<strong>A</strong><br>B`처럼 매치가
    태그 경계에 걸친 경우 여는 태그만 남고 닫는 태그가 같이 지워져 마크업이 깨지는 문제가 새로
    생겨서(직접 겪음, 테스트로 잡음) — 매치 구간 안을 다시 한번 훑어 태그는 전부 보존하고 실제
    텍스트만 한 곳에 newText로 모으는 2단계 스플라이스로 마무리.
- `collectPlainTextSpans`/`replaceAcrossElements`는 삭제(새 구현이 그 역할을 전부 포함).
- 검증: 실제 재현 조각을 그대로 쓴 엔티티 테스트 1개 추가(매치 밖 `&rarr;`는 디코딩되지 않고 그대로
  보존되는지까지 확인), 기존 23개 포함 전부 통과. 확장 67개 전부 통과, lint/tsc/build 클린.

### Next

- 사용자 재검증 대기 — 이번엔 실제 실패 원문으로 직접 재현/수정한 것이라 확신도가 높음.

## 2026-08-10 — 세 번째 원인: 목록을 쉼표로 이어붙여 실제 존재하지 않는 문구를 만들던 버그

엔티티 수정 후에도 다른 이슈에서 또 실패 보고. 진단 로그를 다시 받아보니 이번엔 `oldText`가
`"목표 런칭일:, QA 기간:"`인데 — 이건 원문에 있는 문구가 아니라 **`confluenceParser.ts`가 서로 다른
두 `<li>`("목표 런칭일: ...", "QA 기간: ...")를 `", "`로 이어붙여 만든 가짜 한 줄**이었다. QA 엔진이
그 가짜 텍스트를 그대로 인용했으니, 아무리 storage HTML 매칭 로직을 다듬어도 애초에 존재하지 않는
문구를 찾을 방법이 없었다 — 이건 매칭 알고리즘 문제가 아니라 **QA 엔진에 넘기는 입력 자체가
잘못됐던 것**.

- **`extension/src/content/confluenceParser.ts`**: `htmlToChapterMarkdown`이 `<ul>`/`<ol>`을
  `items.join(', ')`로 한 줄에 뭉치던 걸, 항목마다 `- 항목`으로 별도 줄에 쓰도록 변경. 벤더링된
  review-agent의 `document.py`(`_BULLET_LINE = r"^\s*[-*]\s+.+$"`)가 애초에 `- `로 시작하는 줄을
  불릿(문장 단위) 하나로 인식하도록 짜여 있어서, 이 형식이 원래 review-agent가 기대하던 입력 모양과도
  더 맞다 — 지금까지는 쉼표로 뭉친 프로즈로 들어가 문장 분리기(`_SENTENCE_END`, 마침표/물음표 등
  기준)에 그냥 걸려 있었다.
- **주의**: 이 수정은 **다음 QA 검토부터** 적용된다 — 이미 생성된 이슈(예: 이번에 실패한 "목표
  런칭일" 이슈)는 여전히 옛날 가짜 텍스트를 물고 있어서 재저장해도 안 됨. 사용자에게 QA 검토를
  다시 돌려서 새로 생성된 이슈로 테스트해달라고 안내함.
- 검증: 관련 테스트 갱신(`renders each list item as its own markdown bullet line`), 확장 67개 전부
  통과, lint/tsc/build 클린.

### Next

- 사용자에게 QA 검토 재실행 후 새 이슈로 재검증 요청 — 특히 목록이 포함된 섹션에서 나온 이슈로.
- 예전에 열려 있던 "CLI 6개 vs 서버 40+개" 이슈 개수 불일치 조사와 이 버그가 어느 정도 겹칠 가능성
  있음(가짜 텍스트가 섞인 입력이 이슈 개수/품질에도 영향을 줬을 수 있음) — 재검토 필요.

## 2026-08-10 — 같은 클래스의 버그를 표(테이블)에서도 발견해 같이 고침

사용자가 "그럼 파싱 자체가 잘못되고 있는 거 아냐?"라고 물어서, 목록 말고 다른 곳에도 같은 문제가
있는지 `confluenceParser.ts` 전체를 다시 훑음. **표(`<table>`) 처리 분기가 아예 없어서** 표 전체가
"인식 못 한 엘리먼트" fallback으로 떨어져 `textContent`를 셀 구분자 하나 없이 그냥 이어붙이고
있었다 — 목록의 ", " 이어붙이기보다 더 심한 버전(구분자가 아예 없음). 실제 DOC-001에도 표가 두 개
(경쟁 분석, 마일스톤) 있어서 지금 당장 영향받는 버그였음.

- **`extension/src/content/confluenceParser.ts`**: `TABLE` 분기 추가 — 각 `tr`을 마크다운 표 문법
  (`| 셀1 | 셀2 |`)의 별도 줄로 렌더링. `document.py`의 `_TABLE_ROW_LINE`(`^\s*\|.*\|\s*$`)이 이
  형식의 줄 하나를 행 단위로 인식하도록 이미 짜여 있어서, 목록의 `- ` 불릿과 같은 이유로 이 형식을
  맞춤(구분선(`|---|---|`) 줄은 안 만듦 — document.py가 skip만 할 뿐 요구하지 않아서 생략 가능).
- 검증: 표 렌더링 테스트 1개 추가, 확장 68개 전부 통과, lint/tsc/build 클린.

### Next

- 나머지 fallback 경로(정의 목록, 중첩 목록/표, blockquote 등)에도 비슷한 문제가 있을 수 있으나
  DOC-001엔 없어서 아직 미확인 — 실제로 마주치면 그때 고침.
- 목록/표 두 버그 모두 고쳤으니, 사용자가 QA 검토를 다시 돌려서 최종 검증 필요.

## 2026-08-10 — 진행률 체감 속도 개선 (fake progress 시간 상수 재조정)

"진행바가 너무 느려, 지금 병렬이니까 계산 방식을 최적화해달라"는 요청. `_tick_progress`의 시간 상수
(`_ESTIMATED_DURATION_SECONDS`)가 여전히 **4개 tier가 순차 실행이던 시절 기준(45s)** 그대로 남아
있었음 — 2026-08-10 재벤더링 이후 4개 tier가 `ThreadPoolExecutor`로 동시에 도는데, 곡선은 옛날처럼
"45초짜리 작업"을 가정하고 늘어져서 실제로는 훨씬 빨리 끝나는데도 체감상 계속 낮은 %에 머물러
있었다.

- **`backend/src/sunnic_backend/api/qa_jobs.py`**: `_ESTIMATED_DURATION_SECONDS`를 45.0 → 20.0으로
  재조정. 실측 기준(Claude Haiku→Sonnet 병렬 조합, DOC-001, 66.1초)으로 계산하면 예전 45s
  상수로는 완료 시점(t=66s)에 진행률이 69%에 그쳤는데, 20s로 바꾸면 같은 시점에 86%까지 올라와서
  "끝났는데도 한참 밑에 머물러 있는" 느낌이 크게 줄어든다. 여전히 실제 per-tier 완료 신호는 없어서
  (ADR 0001) 시간 기반 근사인 건 동일 — 상수만 실측치에 맞게 재보정.
  - 여전히 진짜 신호가 아니라는 점은 그대로 남는 한계 — review-agent 파이프라인에 progress 콜백을
    붙이려면 벤더링 정책(ADR 0001, diffable copy 유지)을 깨야 해서 보류 중.
- 검증: 백엔드 85개 전부 통과, ruff 클린(상수 값 외 로직 변경 없음).

### Next

- 실제 사용 중 체감이 여전히 느리면 `_ESTIMATED_DURATION_SECONDS`를 더 낮추거나, 문서 길이에 비례한
  동적 추정으로 바꾸는 것도 고려할 수 있음(지금은 데이터 포인트가 하나뿐이라 고정 상수로 유지).

## 2026-08-10 — Overview "다음/에러" 클릭 시 일부 이슈에서 문서가 안 움직이던 버그 수정

"오버뷰에서 다음을 눌렀을 때 2개는 움직이는데 단어 누락 같은 에러는 안 움직여"라는 보고. 원인은
`wrapIssue()`가 `issue.input_text`를 문서 안에서 찾아 `<mark>`로 감싸는데, **"정보 누락(MI)" 같은
이슈는 애초에 원문에 없는 걸 지적**하므로 `input_text`로 찾을 매치 대상 자체가 없어서 항상 매칭
실패 → 하이라이트가 생성 안 됨 → `scrollToIssue()`가 감쌀 `<mark>`를 못 찾아 스크롤도 안 됨. 정식
`range`/`insert_range` 프레임 렌더링(design spec에서 설계만 하고 아직 구현 안 한 부분, 2026-08-09
`frame_type` 계산 항목 참고)이 아직 없어서 생긴 공백.

- **`extension/src/content/messages.ts`**: `OverlayIssue`에 `location` 필드 추가(`IssueResponse`엔
  이미 있었지만 content script로 안 넘어가고 있었음).
- **`extension/src/hooks/useIssueOverlaySync.ts`**: `location`도 같이 전달하도록 매핑 갱신.
- **`extension/src/content/issueOverlay.ts`**: `wrapIssue()`가 `input_text` 매칭에 실패하면
  `wrapIssueByLocationHeading()`으로 폴백 — `issue.location`(예: "6. 프로덕트 기능 > 6-1. 메인 배너
  (캐러셀)")의 가장 안쪽 위계와 텍스트가 일치하는 제목(h1~h6)을 찾아 그 제목 자체를 감싼다.
  `location`은 `htmlToChapterMarkdown`이 만든 헤딩 텍스트 그대로라 실제 문서 제목과 일치해야 정상.
  클릭 핸들러 부착 로직을 `attachIssueMarkHandlers()`로 뽑아 기존 경로/폴백 경로가 공유하도록 정리.
  - **범위 제한**: 이번 수정은 "스크롤·클릭할 대상이 하나는 있게" 하는 최소 안전망이고, 실제
    range/insert_range 시각적 프레임(구간 전체를 감싸는 등)은 여전히 미구현 — 그건 별도 작업.
- 검증: 신규 테스트 2개(제목 폴백 성공/실패 케이스) 추가, 확장 70개 전부 통과, lint/tsc/build 클린.

### Next

- range/insert_range의 실제 시각적 프레임(구간 전체 하이라이트) 구현은 여전히 남은 작업.
- 사용자 재검증 대기.

## 2026-08-10 — 위 수정 직후 왼쪽 하이라이트/스크롤이 전부 사라진 회귀 수정

바로 다음 리로드에서 "왼쪽 하이라이트 박스랑 스크롤이 사라졌다"는 보고. 원인은
`applyIssueOverlay`가 `issues.filter(wrapIssue)`로 돌리는데, 이슈 하나에서라도 `wrapIssue`가
예외를 던지면 **`filter()` 전체가 그 자리에서 멈춰서 뒤에 있던 멀쩡한 이슈들까지 전부 하이라이트가
안 그려지는 것** — 방금 추가한 `wrapIssueByLocationHeading()`이 `issue.location.split('>')`을
그대로 호출해서, `location`이 없는 이슈(이 필드가 추가되기 전에 만들어진 상태 등)를 만나면 바로
`TypeError`를 던졌다.

- **`extension/src/content/issueOverlay.ts`**: 두 겹으로 방어 — (1) `wrapIssueByLocationHeading`이
  `issue.location?.split('>')`로 옵셔널 체이닝해서 애초에 안 던지게, (2) `applyIssueOverlay`가
  `wrapIssue` 호출을 이슈별로 try/catch로 감싸서, 앞으로 비슷한 종류의(예상 못 한) 에러가 또 나도
  그 이슈 하나만 매칭 실패로 처리되고 나머지는 영향받지 않게.
- 검증: 신규 회귀 테스트 1개(location 없는 이슈가 섞여도 나머지 이슈는 정상 하이라이트되는지) 추가,
  확장 71개 전부 통과, lint/tsc/build 클린.

### Next

- 사용자 재검증 대기 — 이번엔 하이라이트/스크롤 자체가 다시 보이는지부터.

## 2026-08-10 — insert_range(정보 누락) 이슈에서 "제목"이 수정 제안 대상으로 잡히지 않게 제어

`main` 배포 직후 "제목은 제안하지 않도록 제어해줘" 요청 — 확인해보니 섹션 제목(헤딩)에 수정 제안이
걸리는 걸 막아달라는 뜻이었다. 방금 추가한 `wrapIssueByLocationHeading` 폴백이 "정보 누락(MI)"
이슈를 섹션 제목으로 하이라이트하는데, `IssueListScreen`은 `frame_type`과 무관하게 모든 이슈에 똑같이
"수정 저장" 흐름을 열어두고 있어서 — 그대로 두면 사용자가 그 하이라이트에서 "수정 저장"을 눌렀을 때
`oldText = issue.input_text`로 시도하다 결국 섹션 제목 자체가 AI의 "이 정보를 추가하세요" 같은
제안 문구로 통째로 덮어써지는 사고로 이어질 수 있었다(input_text가 비어있으면 저장은 실패하지만,
비어있지 않은 경우엔 진짜로 위험함).

- **`extension/src/components/screens/IssueListScreen.tsx`**: `frame_type === 'insert_range'`인
  이슈는 애초에 편집 모드 진입 자체를 막음(`isEditing`을 로컬에서 항상 `false`로 파생) — "오류
  수정하기" 버튼도 안 보이고, 문서 쪽 하이라이트(제목)를 클릭해 `ISSUE_OVERLAY_FOCUS`로 편집 모드
  진입을 시도해도(전역 상태는 바뀌어도) 이 컴포넌트는 그 상태를 무시하도록 이중으로 막음. 대신
  "문서에 없는 내용을 추가하라는 안내라 자동으로 반영할 수 없다"는 안내 문구를 보여줌.
- **`extension/src/styles/global.css`**: 안내 문구용 `.issue-suggestion-hint` 스타일 추가.
- 검증: 확장 71개 전부 통과(이 UI 분기 자체는 프로젝트에 React 컴포넌트 테스트 도구가 아직 없어
  전용 테스트는 안 붙임 — 기존 컨벤션 유지), lint/tsc/build 클린.

### Next

- React 컴포넌트 레벨 테스트 도구(@testing-library/react 등) 도입 여부는 아직 미정 — 이런 UI 분기
  로직이 늘어나면 필요해질 수 있음.

## 2026-08-10 — 이슈를 문서 본문 순서로 정렬해서 반환 (오버뷰/다음 이동 시 왔다갔다하던 문제)

"오른쪽 패널에서 다음이나 오버뷰를 누르면 문서가 왔다갔다한다, 왼쪽 원본 기준으로 내려가게 해달라"는
요청. 원인은 `GET /qa-jobs/{job_id}/issues`가 **저장된 순서 그대로**(review-agent가 4개 위계
tier를 병렬로 처리하며 붙인 순서, 문서 위치와 무관) 이슈를 내려주고 있었던 것 — SCREEN 02의
"다음"은 이 배열을 그대로 순회하고, 오버뷰 카드는 `criteria`별로 묶어 각 그룹의 첫 이슈로 이동하니,
둘 다 이 순서에 종속돼 있었다.

- **`backend/src/sunnic_backend/api/qa_jobs.py`**: 이슈마다 이미 계산해두고도 아무 데도 안 쓰던
  `start`(문서 텍스트 안 위치)를 활용 — `_issue_start()`를 새로 뽑아서 `input_text`로 못 찾을 때
  (정보 누락=MI 이슈는 원래 `input_text`가 비어있음) 그 이슈가 속한 위계(`location`)의 제목으로
  대신 위치를 잡고, 그마저 못 찾으면 맨 앞(0)이 아니라 맨 뒤로 보내 순서 왜곡을 최소화. `GET
  /qa-jobs/{job_id}/issues`가 응답 직전에 `start` 기준으로 정렬.
  - **프론트엔드는 안 건드림** — `groupIssuesByCriteria`가 이미 "입력 배열에서 각 criteria가 처음
    나오는 순서"를 그대로 보존하도록 짜여 있어서(기존 테스트로도 확인됨), 백엔드가 문서 순서로
    내려주기만 하면 오버뷰 카드 순서도 자동으로 첫 등장 순서(=대략적인 문서 순서)를 따라간다. "다음"
    버튼도 이 배열을 그대로 순회하니 마찬가지로 자동 해결.
- 검증: 신규 테스트 4개(`_issue_start` 3가지 케이스 + 엔드포인트가 실제로 정렬해서 내려주는지) 추가,
  백엔드 89개 전부 통과, ruff 클린.

### Next

- 사용자 재검증 대기 — "다음"/오버뷰 둘 다 왼쪽 문서를 위→아래로 순서대로 훑는지 확인 필요.
- `_issue_start`의 위치 추정은 여전히 근사치(마크다운 평탄화 텍스트 기준 문자열 검색) — 문서 구조가
  복잡해지면(같은 제목이 여러 번 나오는 등) 부정확해질 수 있음, 아직은 실사용 데이터로 검증 전.

## 2026-08-10 — 같은 문서 재검토 시 QA 결과 캐싱 (반복 테스트할 때마다 LLM 다시 호출 방지)

같은 문서(특히 DOC-001)를 반복 테스트할 때마다 실제 Claude API를 매번 새로 호출해서 시간(수십 초)과
비용이 계속 드는 문제 — "같은 문서면 입력값을 캐시로 저장할 수 있냐"는 요청으로 추가.

- **`backend/src/sunnic_backend/api/qa_jobs.py`**: `_execute_qa_job`이 실제 리뷰를 돌리기 전에
  `document_text`의 sha256 해시로 `_review_cache`(프로세스 메모리, `store`와 같은 인메모리 정책)를
  먼저 확인 — 캐시 히트면 `_run_review_sync`(LLM 호출)를 건너뛰고 캐시된 `ReviewResult`를 그대로
  써서 이슈를 매핑한다. `/documents`는 내용이 같아도 매번 새 `document_id`를 발급하므로, 캐시 키는
  `document_id`가 아니라 **문서 내용**(raw_text) 기준 — 컨플루언스에서 같은 페이지를 다시 추출해도
  캐시가 재사용된다. 코드/프롬프트/룰북을 고치면 서버를 재시작하니 그 시점에 캐시도 자연히 비워짐.
- **테스트 격리**: `_review_cache`가 프로세스 전역이라 테스트끼리 상태가 새면(예: 같은
  `_TEST_DOCUMENT`를 쓰는 "LLM 클라이언트 생성 실패" 테스트가 이미 채워진 캐시 덕분에 실제 생성
  자체를 건너뛰고 엉뚱하게 성공해버리는 식) 실행 순서에 따라 결과가 달라지는 사고로 이어질 수 있어,
  `autouse` 픽스처로 매 테스트 전에 캐시를 비우도록 함(세션 초반 `os.environ` 오염 사고와 같은 종류
  — 이번엔 미리 방지).
- 검증: 신규 테스트 2개(같은 내용이면 재사용/다른 내용이면 재사용 안 함) 추가, 백엔드 87개 전부
  통과, ruff 클린.

### Next

- 캐시가 무제한으로 커짐(LRU 등 축출 없음) — 지금은 로컬/데모 용도라 문제 안 되지만, 장시간 여러
  문서를 계속 테스트하면 메모리 사용량이 계속 늘어남. 필요해지면 크기 제한 고려.

## 2026-08-10 — 복제본 제목의 시각이 실제 시각과 어긋나던 버그 수정

"복제본 시간이 안 맞는 거 같다"는 보고. 원인은 `ensureDuplicateSession`의 제목 타임스탬프가
`new Date().toLocaleString('ko-KR')`였는데, **`'ko-KR'` 로케일은 표기 형식(연월일 순서, 오전/오후
등)만 한국식으로 바꿀 뿐 시간대는 실행 환경(브라우저/시스템)의 기본 설정을 그대로 따라간다** —
`timeZone`을 명시하지 않아서, 그 환경의 기본 시간대가 KST가 아니면 실제 시각과 몇 시간씩 어긋나
보였다.

- **`extension/src/content/issueOverlay.ts`**: `toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })`로
  시간대를 명시적으로 고정 — 실행 환경의 기본 시간대 설정과 무관하게 항상 KST로 찍힘.
- 검증: `process.env.TZ`를 `UTC`로 바꾼 채(vitest `vi.stubEnv`) `vi.setSystemTime`으로 고정된
  시각에 대해 Asia/Seoul로 포맷한 문자열이 실제로 제목에 들어있는지(그리고 시스템 기본값으로
  포맷했다면 달랐을 것임을) 확인하는 회귀 테스트 추가. 확장 72개 전부 통과, lint/tsc/build 클린.

### Next

- 사용자 재검증 대기 — 실제 컨플루언스에서 복제본을 만들어 제목 시각이 맞는지 확인 필요.

## 2026-08-10 — review-agent 재벤더링: `category_screen` → `bundled_screen_hybrid`

"planqa-agent 모델 변경됐어 이걸로 하고 우리 .env는 유지해" 요청. upstream이 구조를 또 한 번
바꿨음 — `structures/category_screen.py`가 사라지고 `structures/bundled_screen_hybrid.py`로
교체(+새 데이터 파일 `structures/fewshot_bank.py`, 룰별 위반/예외 퓨샷 예시 모음). 상세 변경
근거/버전별 diff는 `docs/adr/0001-...`의 이번 업데이트 섹션 참고. 요약:

- **4개 동시 tier → 2개 순차 패스로 단순화**: Paragraph 패스(대부분 카테고리) → Document 패스
  (관계형 LG/LF/GA + 부재확인형 LG-01/TC-02)만 순서대로 돈다. **`LLMClient.clone()`이 아예
  없어져서** 지난 재벤더링 때 만든 `_ScopedClient` 우회 코드가 통째로 필요 없어짐 —
  `AnthropicClient`를 그냥 직접 생성하도록 단순화(`qa_jobs.py::_run_review_sync`).
- **진행률 체크리스트도 새 구조에 맞게 다시 짬**: 예전 4그룹(Document/Logical Unit/Paragraph/
  Sentence) 체계는 이제 Logical Unit/Sentence가 아예 안 쓰이는 위계라 실제와 안 맞았음 —
  Paragraph/Document 2그룹으로 교체하고, "동시 실행"이 아니라 "진짜 순차 실행"이 됐으니 lockstep
  대신 **실행 순서대로**(Paragraph가 먼저 100% 찬 뒤에야 Document가 움직이기 시작) 채우도록 함.
- **JSON 파싱이 더 견고해짐**: `llm/base.py`에 `_repair_json`(잘못된 백슬래시/trailing comma
  복구)이 새로 생겼고, `AnthropicClient`가 깨지거나 빈 응답이 와도 한 번 더 재시도함 — 2026-08-09
  Claude 전환 항목에서 관찰만 하고 넘어갔던 "Paragraph 위계 malformed JSON" 이슈를 upstream이
  직접 고친 셈.
- **`.env`/API 키 구성은 그대로 유지** — upstream에 새로 생긴 `llm/factory.py`(환경변수
  `PLANQA_LLM_BACKEND`로 백엔드를 고르는 CLI용 헬퍼)는 벤더링하지 않음. 여전히 `settings`(pydantic-
  settings, `.env` 기반)에서 읽은 키로 `AnthropicClient`를 직접 생성.
- 벤더링 파일: `document.py`(신규 `resolve_reported_level` 포함), `dedupe.py`, `verifier.py`,
  `tiers.py`, `pipeline.py`(여전히 `ReviewResult`만 씀), `instrumentation.py`, `llm/base.py`,
  `llm/anthropic.py`, `planqa_schemas/rulebook.py`, `structures/bundled_screen_hybrid.py`(신규),
  `structures/fewshot_bank.py`(신규) — `llm/gemini.py`/`structures/category_screen.py`는 삭제.
- 검증: 벤더링 테스트 재동기화(`test_bundled_screen_hybrid.py` 신규, `test_fewshot_bank.py` 신규,
  나머지 import 경로만 갱신) + 우리 쪽 테스트(`FakeAnthropicClient`를 새 프롬프트/응답 형식에 맞게
  수정, 진행률 체크리스트 테스트 2개 재작성) 포함 백엔드 126개 전부 통과, ruff 클린.

### Next

- 진행률 체크리스트가 실제로 Paragraph → Document 순서로 차오르는 것처럼 보이는지 실사용 확인.

## 2026-08-10 — bundled_screen_hybrid 실제 Claude API로 라이브 검증 + 진행률 상수 재보정

병합 전에 "이거 다 작동할까?" 질문 — 지금까지는 스크립트 응답(mock)으로만 검증했었어서, 실제
`.env`의 Claude 키로 `review_document()`를 직접 돌려 라이브 검증함(DOC-001 fixture).

- **결과**: 120.3초, **4개 이슈**, `tier_errors: ()`(파싱 에러 0건). 이전 4-tier 조합들(Gemini
  22~44개, Claude 12개)보다 훨씬 적고, CLI 기준값이었던 "6개"에 더 가까워짐 — 여전히 정확히
  일치하진 않지만 방향은 맞는 쪽. 새로 생긴 `resolve_reported_level`도 실제로 작동 확인: MI-06
  이슈가 Paragraph 청크에서 스캔됐지만 confirm이 "Logical Unit"으로 승격 보고해서 그대로 반영됨
  (설계대로).
- **부작용 발견 및 수정**: 소요 시간이 이전 4-tier 동시 실행 버전(66.1초)의 거의 2배(120.3초)로
  늘어남 — 동시성 이점이 없어진 데다(2패스 순차) 프롬프트에 룰 텍스트+퓨샷 예시가 통째로 들어가
  호출 자체도 무거워진 탓. 방금 재보정했던 `_ESTIMATED_DURATION_SECONDS`(20s, 66초 기준)가 이
  새 실측치엔 다시 안 맞아서(완료 훨씬 전에 90%에 도달해 오래 멈춰 있는 것처럼 보임) 35s로 재조정.
- 검증: 백엔드 126개 전부 통과(상수 변경만이라 신규 테스트 없음), ruff 클린.

### Next

- 데이터 포인트가 아직 하나뿐 — 여러 문서/여러 회 실행으로 이슈 개수·소요 시간 편차를 더 확인하면
  좋음.

## 2026-08-10 — review-agent가 bundled_screen_hybrid를 다시 병렬화 (2패스 동시 실행으로 재동기화)

방금 순차 실행으로 재벤더링했는데, review-agent 쪽에서 바로 이어서 그 2패스(Paragraph/Document)를
동시 실행으로 병렬화하는 PR을 올리고 병합함(`sunic5-planqa/planqa-agent` PR #23~#25,
`https://github.com/sunic5-planqa/planqa-agent`). 다시 재벤더링.

- **`instrumentation.py`**: `isolate_client(llm, *, key=None)`으로 시그니처 변경 — `llm`에
  `isolate(key)` 메서드가 있으면(테스트 더블처럼 응답을 분기별로 라우팅해야 하는 경우) 그걸 쓰고,
  없으면(실제 백엔드) 그냥 `copy.copy()` + 새 usage 리스트로 폴백. **덕분에 우리 쪽
  `AnthropicClient`는 `isolate()`를 따로 구현할 필요가 전혀 없음** — `copy.copy()` 폴백이 알아서
  처리해줌(같은 HTTP 클라이언트를 참조로 공유, usage 리스트만 분리).
- **`bundled_screen_hybrid.py`**: 각 패스를 `_run_pass()`로 뽑아내고, 두 패스가 모두 있으면
  `ThreadPoolExecutor`로 동시 실행(하나만 있으면 그냥 직접 호출, 스레드풀 오버헤드 안 씀).
- **`qa_jobs.py`는 무변경** — `_run_review_sync`가 `AnthropicClient`를 그냥 생성만 하면 되는
  구조라(지난 재벤더링 때 이미 그렇게 단순화해둠), 이번 병렬화도 별도 대응 코드 없이 그대로 호환됨.
- **진행률 체크리스트를 다시 lockstep으로 되돌림** — 방금 "순차 실행" 가정으로 바꿨던 걸(Paragraph
  먼저 100%) 원래의 "모든 그룹 동시 진행" 방식으로 원복. 실측도 다시 확인(DOC-001, Claude
  Haiku→Sonnet 조합): **63.1초**(순차 버전 120.3초 대비 거의 절반, 원래 4-tier 버전 66.1초와
  거의 동일) — `_ESTIMATED_DURATION_SECONDS`도 35s→20s로 원복.
- **테스트 더블도 동기화**: `conftest.py`의 `ScriptedLLM`이 `tier_responses`/`clone()`(죽은 코드)
  대신 `keyed_responses`/`isolate()`를 구현 — key 없이 `isolate()`가 호출되면(테스트 더블에
  `keyed_responses`를 안 주고 병렬 구조를 테스트하려 한 경우) 애매하게 넘어가지 않고 명확한
  에러를 던짐(공유 이터레이터 레이스를 나중에 조용히 재현하는 대신 지금 바로 잡아냄).
- 검증: 벤더링 테스트 재동기화(`test_bundled_screen_hybrid.py`가 `keyed_responses` 기반으로,
  신규 "plain ScriptedLLM 오용 시 명확한 에러" 테스트 포함) + 우리 진행률 테스트 lockstep으로
  원복, 백엔드 126개 전부 통과, ruff 클린. 실제 API로도 재검증(4개 이슈, 에러 0건, 63.1초).

### Next

- upstream이 짧은 주기로 계속 구조를 바꾸고 있어 재벤더링이 반복되는 중 — 당분간 병합 전마다
  `sunic5-planqa/planqa-agent`의 최신 상태를 확인하는 습관이 필요.

## 2026-08-10 — 병렬화 재벤더링 PR `/code-review` 결과 반영

6개 지적 중 우리 코드(`qa_jobs.py`)에 해당하는 1개만 고치고, 나머지 5개는 전부 벤더링해온 파일
(`review_agent/**`, ADR 0001 정책상 upstream과 diffable하게 그대로 두기로 한 영역) 안의 지적이라
로컬에서 고치지 않음 — 지금까지 반복해온 판단 기준 그대로.

- **고침**: `_build_tier_groups`(진행률 체크리스트)가 `_RANGE_CATEGORIES`(LG/LF/GA)만 보고
  Paragraph/Document 그룹을 나누는데, 실제 실행 구조(`_paragraph_and_document_rules`)는
  개별 rule_id(`ABSENCE_CHECK_RULE_IDS` = LG-01, TC-02)도 Document 패스로 보낸다는 걸 놓쳤다는
  지적 — "TC" 카테고리 전체가 Paragraph 그룹에 표시되는데 그중 TC-02 하나만 실제로는 Document
  패스에서 검토됨. 체크리스트가 카테고리 단위라 완벽히 정확하게 쪼갤 수 없어서(이미 가짜인 진행률
  신호에 그 정도 복잡도를 들일 가치가 없다고 판단), 코드를 바꾸는 대신 이 한계를 주석에 정직하게
  남기는 쪽으로 고침.
- **판단 보류(벤더링 정책)**: `conftest.py`의 `ScriptedLLM.complete_json`이 `cache_prefix` 파라미터
  없이 인터페이스에서 벗어났다는 지적, 벤더링 파일 여러 곳의 120자 줄 길이 초과, 벤더링 테스트
  파일의 docstring, `document.py`의 중복된 주석 문구(upstream 자체의 복붙 흔적으로 보임) — 전부
  `review_agent/**` 안의 upstream 코드라 로컬에서 고치지 않음.
- 검증: 백엔드 126개 전부 통과, ruff 클린.

## 2026-08-10 — 수정 저장 시 유사도 경고 문구에서 괄호 제거

`IssueListScreen.tsx`의 유사도 경고("AI 제안(...)과 다소 달라요")가 AI 제안 문구를 괄호로 감싸고
있던 걸 큰따옴표로 바꿈 — "AI 제안 "...".과 다소 달라요 (유사도 N%)." 형태로, 뒤에 남은 유사도
퍼센트 괄호는 그대로 둠.

- **`extension/src/components/screens/IssueListScreen.tsx`**: `handleSaveClick`의
  `setSimilarityWarning` 문구 수정 — 처음엔 괄호 대신 큰따옴표로 AI 제안 문구를 감쌌는데, 곧이어
  "따옴표도 빼고 그냥 짧게" 요청이 와서 AI 제안 문구 자체를 안 보여주고 "AI 제안과 다소 달라요
  (유사도 N%)."만 남기는 걸로 다시 정리.
- 검증: 확장 72개 전부 통과, lint/tsc/build 클린.

## 2026-08-10 — MI(정보 누락) 카테고리 오탐 검증 단계 추가

실제 서버(DOC-001)에서 "8. 런칭 계획"에 목표 런칭일/QA 기간 날짜가 명시돼 있는데도 confirm이
"정보 누락"으로 잘못 판정하는 오탐 보고. 먼저 우리 쪽 파싱 문제인지 확인 — 실제 storage HTML을
가져와 `htmlToChapterMarkdown`에 그대로 넣어보니 날짜가 정확히 뽑힘(`- 목표 런칭일: February
10, 2024` 등). **파서 문제 아님** — confirm이 좁은 chunk만 보고 판단하다 생긴 진짜 hallucination.

`services/eval-service`(`sunic5-planqa/planqa-agent`)를 재사용할 수 있는지 검토 — `judge.py`의
`judge_review_result()`는 **원본 문서 텍스트를 아예 안 받는** reference-free 구조(에이전트 자신의
근거/이유만 재검토)라, "근거는 논리적인데 전제가 문서와 안 맞는" 이런 유형은 애초에 못 잡는다는 걸
확인 — 재사용 불가 판단.

- **`backend/src/sunnic_backend/api/qa_jobs.py`**: `_run_review_sync`에 MI 카테고리 전용 검증
  단계 추가 — confirm이 낸 MI 판정마다, **문서 전체 텍스트**를 다시 주고 "정말 없는 게 맞냐"고
  Sonnet으로 재확인(`_verify_mi_finding`). 검증에서 "실제로 있다"고 나오면 그 이슈를 최종 결과에서
  제외. LLM 호출 실패/응답 이상 시엔 원래 판정을 신뢰(fail-safe, 조용히 숨기지 않음). MI만
  검증하는 이유: 관찰된 오탐이 전부 MI였고, "없다"는 주장이 정의상 부분 컨텍스트에 특히 취약함 —
  전체 카테고리에 걸면 비용/시간이 크게 늘어남.
- 검증: 단위 테스트 4개(검증 통과/탈락/LLM 에러 시 폴백/응답 이상 시 폴백) + 통합 테스트 1개
  (강제로 오탐 상황을 만들어 실제로 걸러지는지) 추가, 백엔드 131개 전부 통과, ruff 클린. 실제
  API로 라이브 재검증 2회 — 검증 로직이 실제 MI 판정에 정상적으로 관여하는 것 확인(LLM이
  결정적이지 않아 정확히 같은 오탐이 매번 재현되진 않았지만, 강제 재현 테스트로 필터링 자체는
  100% 확인됨).

### Next

- 지금은 MI만 검증 — 다른 카테고리에서도 비슷한 오탐 패턴이 관찰되면 확장 고려.
- 검증 호출이 추가돼서 MI 이슈 개수만큼 소요 시간이 늘어남 — 체감 속도에 영향 있으면
  `_ESTIMATED_DURATION_SECONDS`도 재검토 필요.

## 2026-08-10 — Document 위계 이슈가 페이지 제목(h1)을 감싸버리던 버그 수정

"문서 제목에서 그걸 알려준다는 거 자체가 헛소리"라는 보고 — 스크린샷을 보니 논리비약(LG) 이슈의
하이라이트가 컨플루언스 페이지 자체의 제목을 감싸고 있었음. 원인: review-agent가 Document
위계(문서 전체를 대상으로 한 판정)로 낸 이슈는 `location`이 곧 **문서 제목**이다(백엔드
`document.py`의 `_doc_title()` — `htmlToChapterMarkdown`이 페이지 제목만 `#`(h1급)로 쓰고 본문
소제목은 전부 `##`~`######`로 클램프하기 때문에, Document 위계 청크의 location은 항상 페이지
제목과 정확히 일치). 그런데 2026-08-10에 추가한 `wrapIssueByLocationHeading` 폴백(본문에서
input_text를 못 찾을 때 location과 이름이 같은 제목이라도 감싸는 로직)이 h1~h6을 다 검색 대상으로
삼아서, 이 경우엔 페이지 자체의 제목(h1)을 감싸버렸다.

- **`extension/src/content/issueOverlay.ts`**: `wrapIssueByLocationHeading`의 검색 대상에서
  **h1을 제외**(h2~h6만) — 본문 소제목만 유효한 폴백 대상. h1만 일치하는 경우(Document 위계
  이슈)는 하이라이트 없이 넘어간다(엉뚱한 걸 감싸느니 안 감싸는 쪽).
- 검증: 신규 회귀 테스트 1개(h1만 일치할 때 매칭 실패 확인) 추가, 확장 73개 전부 통과,
  lint/tsc/build 클린.

### Next

- Document 위계 이슈는 이제 본문에 하이라이트가 아예 안 생길 수 있음(폴백 대상이 없어서) — 사이드
  패널에서 이슈 자체는 여전히 보이고 판단 가능하지만, "다음"으로 넘겨도 문서가 안 움직일 수 있음.
  더 나은 폴백(예: 문서 맨 위로 스크롤만)이 필요한지는 실사용 확인 후 판단.

## 2026-08-10 — 수정 저장 성공 시 다음 이슈로 자동 이동

"수정 완료 누르면 다음 에러로 자동으로 내려가게" 요청.

- **`extension/src/components/screens/IssueListScreen.tsx`**: `saveEdit()`이 저장 성공(스테이징 +
  편집 모드 종료) 직후 `NAVIGATE_ISSUE(direction: 'next')`를 디스패치 — 마지막 이슈였으면
  `appReducer.ts`의 인덱스 clamp 덕분에 별도 경계 처리 없이 그냥 제자리에 머문다. 왼쪽 문서
  스크롤/AI 제안 말풍선은 기존 `useIssueOverlaySync`의 `currentIssueId` 변경 감지 로직이 그대로
  이어받아 처리(추가 배선 불필요) — "이전/다음" 버튼으로 수동 이동할 때와 동일한 경로.
- 검증: 확장 73개 전부 통과, lint/tsc/build 클린(이 컴포넌트는 React 컴포넌트 테스트 도구가 아직
  없어 전용 테스트는 기존 컨벤션대로 생략).

## 2026-08-10 — 복제본 제목 시각, Intl 대신 순수 산술 계산으로 재작성

`timeZone: 'Asia/Seoul'`을 명시한 `toLocaleString`으로 고쳤는데도(2026-08-10 앞선 항목) 사용자가
"여전히 실제 시각과 몇 시간 차이난다"고 재보고 — Intl 구현/브라우저 환경에 남아있을 수 있는 변수
자체를 없애기로 하고, `Intl`에 전혀 기대지 않는 방식으로 다시 짬.

- **`extension/src/content/issueOverlay.ts`**: `formatKstTimestamp(date)` 신규 — `Date.getTime()`의
  epoch ms(시간대와 무관한 절대 시각)에 KST 오프셋(UTC+9, 서머타임 없어 연중 고정)을 직접 더한 뒤
  `getUTC*` getter로 값을 읽어 문자열을 조립. 실행 환경의 Intl 지원 수준이나 시스템 시간대 설정에
  전혀 의존하지 않는 순수 산술 계산이라, 어떤 환경에서 실행되든 항상 정확하다.
- 검증: `formatKstTimestamp` 자체의 경계 케이스(정오, 자정 넘어감, 오후) 단위 테스트 3개 +
  기존 통합 테스트를 새 방식에 맞게 갱신, 확장 76개 전부 통과, lint/tsc/build 클린.

### Next

- 사용자 재검증 대기 — 이번엔 Intl 자체를 안 쓰니 환경 의존성 문제는 원천적으로 없어야 함.

## 2026-08-10 — AI 제안 말풍선에서 따옴표로 감싼 구체적 제안치만 그라데이션 강조

"AI 제안 말풍선에서 중요한 단어에 그라데이션 글씨 넣어" 요청 — 문장 전체를 다 강조하면 오히려
핵심이 안 보여서, 따옴표로 감싼 부분(구체적 대안/인용구, 예: `'핵클 SDK 연동'으로 수정`)만 골라
강조하기로 함.

- **`extension/src/content/issueOverlay.ts`**: `highlightQuotedSpans()` 추가 — 작은따옴표/큰따옴표로
  감싼 구간을 정규식으로 찾아 `.sunnic-tooltip-quote`(보라→핑크 그라데이션, `ACTIVE_CLASS`와 같은
  135deg 팔레트로 통일) span으로 감싼다. 겸사겸사 `issue.suggestion`을 그동안 이스케이프 없이
  `innerHTML`에 그대로 꽂고 있던 것도 `escapeHtml()`로 고침(LLM 응답에 `<`/`&` 같은 문자가 섞이면
  마크업으로 잘못 해석될 수 있었던 잠재 위험).
- 검증: 신규 테스트 2개(따옴표 강조 확인, HTML 이스케이프 확인) 추가, 확장 78개 전부 통과,
  lint/tsc/build 클린.

## 2026-08-10 — 오른쪽 패널(수정제안/검증이유)에도 따옴표 그라데이션 강조 확장

"말풍선처럼 오른쪽 패널 수정제안도, 검증이유도 중요한 글자만 그라데이션으로" 요청 — 방금 만든
AI 제안 말풍선의 "따옴표 구간만 강조" 로직을 사이드패널(React)에도 그대로 확장.

- **`extension/src/utils/quoteSegments.ts`**(신규): `splitQuotedSegments()` — 따옴표 구간 분리
  정규식 로직을 content script와 사이드패널이 공유하도록 뽑아냄(렌더링 방식은 각자 다름 — HTML
  문자열 조립 vs React 엘리먼트). `issueOverlay.ts`의 `highlightQuotedSpans()`도 이걸 쓰도록 리팩터.
- **`extension/src/components/common/QuoteHighlightedText.tsx`**(신규): 위 분리 로직을 React
  엘리먼트로 렌더링하는 공용 컴포넌트.
- **`extension/src/components/screens/IssueListScreen.tsx`**: `수정제안`/`검증이유` 텍스트를
  `QuoteHighlightedText`로 감싸서 따옴표 구간만 강조.
- **`extension/src/styles/global.css`**: `.issue-suggestion-text`가 문장 전체를 그라데이션 처리하던
  걸(Figma 초기 실측 스타일) 일반 텍스트로 바꾸고, 공용 `.gradient-quote` 클래스를 새로 추가 —
  수정제안/검증이유 둘 다 이 클래스로 따옴표 구간만 강조.
- 검증: `splitQuotedSegments` 단위 테스트 6개 추가, 확장 84개 전부 통과, lint/tsc/build 클린.

## 2026-08-10 — 같은 문구에 여러 룰이 충돌할 때 더 시급한 카테고리만 남기기

실사용 중 확인된 사례: 같은 입력내용("Q. 당일 배송은 어떤 지역에서 가능한가요? A. ...")에
"용어 오용(TM)"과 "상위 목표와의 정합성(GA)"이 동시에 걸려 카드 두 개로 중복 표시됨. "카테고리별
고정 우선순위로 더 시급한 것 하나만" 방향으로 진행(사용자 확인).

- **`backend/src/sunnic_backend/api/qa_jobs.py`**: `_CATEGORY_PRIORITY` 신규 — GA(상위 목표
  충돌) > LG(논리비약) > LF(논리흐름) > MI(정보 누락) > RD(불필요한 중복) > AE(모호한 표현) >
  TM(용어 오용) > TC(용어 일관성) 순으로 시급도 배치(구조적 문제 > 정보 완결성 > 표현 품질 —
  정답이 하나로 정해진 값은 아니라 팀 판단이 바뀌면 순서만 조정하면 됨). `_dedupe_conflicting_
  categories()`가 같은 (location, original_text) 조합을 가진 이슈들 중 우선순위가 가장 높은
  카테고리 하나만 남김. 벤더링된 `dedupe.py::dedupe_issues()`는 "같은 rule_id + 겹치는 위치"만
  접도록 의도적으로 짜여 있어서(다른 rule_id는 별개로 보존) 이건 그 위에 얹는 우리 쪽 후처리.
  MI처럼 인용문(`original_text`)이 없는 이슈는 "같은 문구"인지 판단할 근거가 없어 손대지 않음
  (잘못 묶으면 서로 다른 결측 항목이 하나로 사라질 위험).
- 검증: 신규 테스트 4개(우선순위대로 남김, 입력 순서 무관, 위치/문구 다르면 둘 다 보존, 인용문
  없으면 안 건드림) 추가, 백엔드 135개 전부 통과, ruff 클린.

### Next

- 실제 서버에서 카테고리 충돌 사례로 재검증 필요(이번 건 순수 후처리 로직이라 LLM 호출 없이도
  결정적으로 검증 가능해서 라이브 재현은 생략함).

## 2026-08-10 — Render 무료 티어 배포 설정 준비

"5명이 설치 쉽게, 최대한 공짜로" 요청 — `localhost:8000` 기본값은 각자 자기 컴퓨터를 가리키는
거라 원격 팀원에게는 애초에 안 닿는다는 걸 짚고, 클라우드 배포로 방향을 정함(자세한 근거는
`docs/adr/0002-deploy-backend-to-render-free-tier.md`). 계정 생성/연결은 사용자가 직접 해야 해서,
이번엔 리포 쪽에서 준비할 수 있는 설정 파일과 안내 문서까지만.

- **`render.yaml`**(신규, 리포 루트): Render Blueprint 스펙 — `rootDir: backend`,
  `uv sync --frozen`으로 빌드, `uv run uvicorn ... --host 0.0.0.0 --port $PORT`로 시작,
  `/healthz`를 헬스체크 경로로 지정. `ANTHROPIC_API_KEY`/`ALLOWED_ORIGINS`는 `sync: false`(대시보드에서
  직접 채우는 시크릿, 커밋 안 됨).
- **`extension/manifest.config.ts`**: `api/client.ts`가 이미 쓰던 `VITE_API_BASE_URL` 환경변수를
  빌드 시점에 같이 읽어서, 값이 있으면 그 origin도 `host_permissions`에 추가 — 없으면 기존
  `localhost:8000` 그대로(로컬 개발 흐름 무변경). 이 값만 지정하면(`VITE_API_BASE_URL=https://...
  npm run build`) 배포된 백엔드를 가리키는 확장이 바로 빌드됨.
- **`docs/deployment.md`**(신규): 계정 생성부터 5명에게 배포까지 실제로 클릭할 순서 정리.
- 검증: 확장 84개 전부 통과, `VITE_API_BASE_URL` 지정/미지정 양쪽으로 직접 빌드해서
  `dist/manifest.json`에 origin이 제대로 반영되는지 확인.

### Next

- 사용자가 직접: Render 계정 생성 → Blueprint 연결 → API 키 입력 → 배포 → 확장 ID 확인 →
  ALLOWED_ORIGINS 채우기(`docs/deployment.md` 순서대로) — 완료되면 실제 배포 주소로 재검증 필요.

## 2026-08-10 — 실제 배포 완료, keep-alive 핑 추가

사용자가 Render 계정 생성부터 배포까지 직접 진행 완료. `https://sunnic-backend.onrender.com`이
실제로 살아있음(`/healthz` 200 확인). 확장을 그 주소로 빌드해서 zip으로 전달할 수 있게 준비하고,
무료 티어 슬립 문제를 완화하는 자동 핑을 추가했다.

- 확장 ID를 직접 로드해보지 않고 계산: `dev-key.public.txt`의 base64 DER 공개키를 SHA256 해시한
  뒤 첫 16바이트를 Chrome의 a-p 매핑 규칙으로 변환 — `lakdhpgnlleljlkkfobckijbnojlplcf`.
  Render의 `ALLOWED_ORIGINS`에 `chrome-extension://lakdhpgnlleljlkkfobckijbnojlplcf`로 설정.
- `VITE_API_BASE_URL=https://sunnic-backend.onrender.com npm run build`로 확장 빌드,
  `dist/manifest.json`에 그 origin이 `host_permissions`에 정상 반영된 것 확인 → `extension/dist`를
  `sunnic-extension.zip`(131KB)으로 압축(gitignore된 산출물이라 커밋 안 함, 로컬에만 존재).
  나머지 4명에게는 이 zip 파일만 전달하면 됨 — 깃허브 링크나 별도 서버 접속 불필요, 언팩 로드만 하면 끝.
- **`.github/workflows/keep-alive.yml`(신규)**: Render 무료 티어가 15분 무트래픽 시 슬립하는 걸
  완화하기 위해 10분마다 `/healthz`를 호출하는 GitHub Actions 스케줄 워크플로 추가. 사용자가
  "자동으로 계속 연장" 방법을 물어서 3가지 옵션(GitHub Actions / 외부 무료 핑 서비스 / 유료 전환) 중
  GitHub Actions를 선택 — 저장소 안에서 완결되고 별도 가입이 필요 없어 마찰이 가장 적음. 24시간
  계속 깨어있게 하면 Render 무료 티어의 월 750시간 인스턴스 한도를 거의 다 쓰게 된다는 점은
  ADR/문서에 남김(지금은 서비스가 이거 하나뿐이라 문제 없음).

### Next

- GitHub Actions 스케줄이 실제로 10분마다 도는지, 그 핑만으로 슬립을 막기에 충분한지는 며칠
  지켜봐야 확인 가능(cron은 GitHub 쪽 사정으로 몇 분 밀릴 수 있음 — 알려진 한계).
- 나머지 4명에게 zip 배포 후 실제 왕복(설치→컨플루언스 페이지에서 QA 시작→응답) 확인 필요 —
  아직 Claude가 검증할 수 없는 부분.

## 2026-08-10 — 이슈 카드에 위치(location) 표시 추가

"수정 제안할 때 번호(예: 1-2, 2)를 안 보여준다"는 사용자 지적을 조사 — 모델도 백엔드도 아니라
**프론트 표시 누락**이었다. `location`은 이미 review-agent 출력(`document.py`가 문서 헤딩 텍스트를
그대로 가져와 만든 값, 원문에 "8. 런칭 계획"처럼 번호가 있으면 그대로 포함)부터 백엔드 API 응답
(`qa_jobs.py`)까지 전부 전달되고 있었고, `types.ts`에도 필드가 있었지만 `IssueListScreen.tsx`가
카드에 렌더링한 적이 없었다(`issueOverlay.ts`의 본문 하이라이트 매칭용으로만 내부 사용).

- `IssueListScreen.tsx`: `issue-detail-card` 최상단에 `issue-location` 문단 추가 —
  `issue.location`을 보여주고, `related_location`이 있으면(LG/LF/GA 관계형 규칙) `location ↔
  related_location` 형태로 두 위치를 함께 표시.
- `global.css`: `.issue-location`(accent 컬러, 굵게, 작은 폰트) 신규.
- 별도 백엔드/모델 변경 없음 — 이미 있던 데이터를 노출만 함.
- 검증: `typecheck`/`lint`/`build`/`vitest` 84개 전부 통과(신규 컴포넌트 테스트는 기존에도
  화면 컴포넌트 테스트가 없는 컨벤션이라 추가 안 함).

### Next

- **Claude가 검증 불가능한 것**: 실제 문서에서 헤딩에 번호가 없는 경우(원문 저자가 "런칭 계획"만
  쓰고 "8."을 안 붙인 경우) 카드에 번호 없이 제목만 뜨는 게 맞는지, 아니면 문서 구조에서 순번을
  계산해서 붙여야 하는지는 실제 화면 보고 사용자 확인 필요.

## 2026-08-10 — AI 제안 말풍선이 엉뚱한 위치(좌상단)에 뜨는 버그 수정

실사용자가 스크린샷으로 보고 — 오른쪽 패널 "다음/이전"으로 이슈를 옮기면 AI 제안 말풍선이 본문의
실제 위치가 아니라 화면 좌상단(컨플루언스 사이드바 근처)에 뜸.

- **원인**: `scrollToIssue()`가 `mark.scrollIntoView({behavior:'smooth'})`를 건 직후, 같은 틱에
  바로 `showTooltip()`을 호출 — 이때 `getBoundingClientRect()`는 스크롤 애니메이션이 시작되기도
  전의 옛 위치를 읽는다. 이전에 추가해둔 `scroll` 이벤트 기반 재계산(`repositionActiveTooltip`)이
  이 경우를 보완하도록 돼 있었지만, 컨플루언스의 내부 스크롤 컨테이너 구조/타이밍에 따라 그 이벤트가
  우리가 잡을 수 있는 방식으로 안 날 수 있어 옛 위치에 고정돼버리는 케이스가 남아있었다.
- **`issueOverlay.ts`**: `scroll`/`resize` 이벤트 리스너에 의존하는 대신, 말풍선을 여는 시점부터
  800ms 동안(일반적인 smooth scrollIntoView 소요 시간을 여유 있게 덮음) `requestAnimationFrame`으로
  매 프레임 강제로 위치를 재계산하는 `startContinuousReposition()` 추가. 이벤트가 아예 안 나는
  경우까지 포함해 원인에 상관없이 최종 위치를 항상 맞게 만드는 방어적 수정. 기존 스크롤/리사이즈
  리스너는 800ms 이후(말풍선이 오래 열려있는 동안의 추가 스크롤)를 위해 그대로 유지.
- 회귀 테스트 추가: `scroll` 이벤트를 **한 번도 발생시키지 않고** rAF만으로 위치가 스스로 보정되는지
  확인(`vi.useFakeTimers()` + `vi.advanceTimersByTime(800)`).
- 검증: `typecheck`/`lint`/`build`/`vitest` 85개(신규 1개 포함) 전부 통과. `extension/dist`를
  다시 빌드해 `sunnic-extension.zip` 갱신 — 재배포 필요.

### Next

- **Claude가 검증 불가능한 것**: 실제 컨플루언스 페이지에서 "다음/이전"으로 여러 이슈를 빠르게
  옮겨다니며 말풍선이 항상 본문 하이라이트 바로 아래에 뜨는지 확인 필요 — 정확한 근본 원인(어떤
  스크롤 컨테이너가 이벤트를 안 냈는지)까지는 재현 환경 없이 특정 못 함, rAF 강제 재계산은 원인에
  상관없이 결과를 맞추는 방어적 수정이라 원인 자체가 다른 것이었을 가능성도 있음.

## 2026-08-11 — 목록/표 이슈의 프레이밍·수정 적용 실패 근본 원인 수정

알파테스트 참여자가 9개 항목의 피드백을 남김(카카오톡). 그중 "1. 팝업 위치 이상함, 2. 프레이밍 안 됨,
3. 프레이밍이 안 돼서 수정도 안 됨"을 최우선으로 잡기로 사용자와 합의(같은 원인일 가능성이 높다는
사용자 자신의 추측이 맞았음).

- **원인**: `bundled_screen_hybrid.py`가 모델에게 "자기가 받은 청크를 그대로(verbatim) 인용해서
  original_text/input_text를 채우라"고 지시하는데, 그 청크는 `confluenceParser.ts`가 `<li>`를
  `"- item"`으로, `<tr>`을 `"| 셀 | 셀 |"`로 평탄화한 마크다운이다(review-agent의 `document.py`가
  기대하는 형식에 맞추기 위한 합성 문자). 모델이 목록/표 항목을 인용하면 이 `- `/`| |` 기호가
  input_text에 그대로 섞여 들어오는데, 실제 컨플루언스 렌더링 DOM의 `<li>`/`<td>` 텍스트나 저장할 때
  다시 읽는 storage HTML엔 이 기호가 애초에 존재하지 않아 — 리터럴 매칭이 구조적으로 항상 실패했다.
  프레이밍(본문 하이라이트) 실패 → 대체 위치(섹션 제목)로 폴백 → 말풍선이 엉뚱한 곳에 뜨는 것처럼
  보이고, 같은 매칭 로직을 쓰는 저장(`applyIssueEdit`→`replaceInStorageHtml`)도 함께 실패했다.
- **`issueOverlay.ts`**: `wrapIssue`(본문 하이라이트)와 `replaceInStorageHtml`(실제 저장)이 공유하는
  `buildLooseTextRegex`에 `stripMarkdownArtifacts()` 전처리 추가 — 매칭 전에 줄 단위로 앞의 `- `
  접두사, 행 앞뒤의 `|`를 걷어낸다. 표 셀 사이(행 안쪽)의 `|`는 완전히 제거하는 대신, 그 양옆 공백을
  포함해 통째로 `\s*`(0개 이상 공백)로 느슨화 — 실제 DOM에서 인접한 `<td>` 사이에 구분 문자가
  전혀 없을 수도 있기 때문(공백 1개 이상을 강제하면 그 경우도 다시 놓친다).
- 회귀 테스트 2개 추가: 불릿 접두사가 섞인 input_text로 `<li>` 본문 하이라이트가 되는지
  (`applyIssueOverlay`), 표 구분자가 섞인 oldText로 `<td>` 저장 치환이 되는지(`applyIssueEdit`).
- 검증: `typecheck`/`lint`/`build`/`vitest` 88개(신규 2개 포함) 전부 통과. `sunnic-extension.zip`
  재빌드 완료 — 재배포 필요.

### Next

- **Claude가 검증 불가능한 것**: 실제 알파테스트 문서에서 목록/표 기반 이슈들이 이제 본문에
  정확히 하이라이트되고, "수정 저장"이 실제로 컨플루언스에 반영되는지 확인 필요.
- 이 수정으로 1번(말풍선 위치)이 완전히 해소되는지, 아니면 지난번 스크롤 타이밍 수정과 이번 매칭
  수정 두 원인이 섞여 있었는지는 실사용 재확인 전까진 확정 못 함.
- 나머지 피드백(4~9번: 유사도 검사가 지시형 제안엔 안 맞는 문제/넘버링 재설계/관계형 이슈 다중
  위치 편집/삽입형 프레이밍 확장/MI 과탐지/QA완료 뒤 뒤로가기)은 사용자 확인 후 순서대로 진행 예정 —
  특히 7번(삽입형 프레이밍)은 사용자가 언급한 노션 문서 내용을 아직 못 받아서 착수 보류.

## 2026-08-11 — "cross-world extension resource mismatch" 로딩 오류 수정

두 명이 사이드패널이 아예 안 열린다고 보고. 어제 "Chrome Canary 채널 버그라 우리 쪽에서 못 고친다"고
안내했는데, 이번 제보자는 `chrome://version`에 `cohort: Stable`(151.0.7922.76, 정식 버전)로 찍혀
있어 그 진단이 틀렸음이 확인됨 — 우리 빌드 쪽 문제였다.

- **원인**: Vite가 기본으로 진입점 HTML에 `<link rel="modulepreload" crossorigin href="...">`를
  자동 삽입하는데, MV3 확장 페이지에서 이 태그가 일부 Chrome(버전 무관, Canary 한정 아니었음)에서
  "cross-world extension resource mismatch"라는 실제 크로미움 버그를 유발함 — 정확히 같은 에러가
  MetaMask에서도 보고됨([MetaMask/metamask-extension#44792](https://github.com/MetaMask/metamask-extension/issues/44792)).
  이 오류가 나면 `src/sidepanel/index.html` 자체가 못 뜨니 사이드패널이 완전히 먹통이 된다.
- **`vite.config.ts`**: `build.modulePreload: false` 추가 — modulepreload는 순수 성능 힌트일 뿐,
  꺼도 진입 스크립트가 네이티브 ES `import`로 청크를 정상적으로 가져오니 기능 손실 없음. 빌드된
  `dist/src/sidepanel/index.html`에서 해당 `<link>` 태그가 완전히 사라진 것 확인.
- 검증: `typecheck`/`lint`/`vitest` 88개 전부 통과(모듈 프리로드 제거는 런타임 동작과 무관해 신규
  테스트 없음). `sunnic-extension.zip` 재빌드 완료 — 재배포 필요.

### Next

- **Claude가 검증 불가능한 것**: 이 오류를 실제로 겪었던 두 명이 새 zip으로 다시 로드했을 때
  사이드패널이 정상적으로 뜨는지 확인 필요. 이 버그는 재현이 간헐적이었을 가능성도 있어(크로미움
  버그 자체가 어떤 조건에서 트리거되는지 불명확), 100% 해소를 장담하긴 어려움 — 계속 재현되면
  추가 보고 필요.
- 사용자 관찰: "맥북만 되고 윈도우는 안 된다" — 위 크래시를 실제로 겪은 제보자가 Windows 11이었던
  것과 일치. 크로미움 버그가 OS별로 다르게 트리거될 가능성이 있어 보이나 확정은 못 함.

## 2026-08-11 — 새 편집기 초안 URL("/pages/edit-v2/{id}")에서 "컨플루언스 아님" 오탐 수정

여러 명이 실제 컨플루언스 페이지에서도 "컨플루언스 페이지가 아닙니다"가 뜬다고 보고. 실제 URL
(`https://playonejr.atlassian.net/wiki/spaces/~712020b/pages/edit-v2/294914?draftShareId=...`)을
받아서 확인.

- **원인**: `extractPageId()`의 경로 정규식(`/\/pages\/(\d+)/`)이 "pages/" 바로 뒤에 숫자가 오는
  형태만 인식하는데, 컨플루언스 새 편집기(초안 편집 화면)의 URL은 `/pages/edit-v2/{id}`처럼 모드
  이름이 한 단계 더 끼어든다 — 도메인은 `*.atlassian.net`으로 정확히 맞아 콘텐츠 스크립트는
  주입됐지만, 페이지 ID를 못 뽑아내 항상 `NOT_A_CONFLUENCE_PAGE`로 떨어졌다.
- **`confluence-extractor.ts`**: 정규식을 `/\/pages\/(?:[\w-]+\/)?(\d+)/`로 완화 — "pages/"와
  숫자 ID 사이에 영숫자/하이픈 모드 세그먼트가 하나 끼어도 건너뛴다("edit-v2"처럼 숫자가 섞인
  모드명도 있어 `[a-z-]+`로는 부족해 `\w`로 확장). 세그먼트가 아예 없는 기존 `/pages/{id}/title`
  형태는 정규식 백트래킹으로 그대로 매칭됨(하위 호환).
- 회귀 테스트 추가: 실제로 받은 `edit-v2` URL로 정확한 페이지 ID가 추출되는지 확인.
- 검증: `typecheck`/`lint`/`vitest` 89개(신규 1개 포함) 전부 통과. modulepreload 수정과 함께
  `sunnic-extension.zip` 재빌드 완료 — 재배포 필요.

### Next

- **Claude가 검증 불가능한 것**: 실제로 이 오류를 겪은 사람들이 새 zip으로 `/pages/edit-v2/...`
  URL에서 정상적으로 QA를 시작할 수 있는지 확인 필요. 다른 미확인 URL 변형(예: 스페이스 개요,
  블로그 포스트 등)이 더 있을 수 있어 — 계속 실패 보고가 오면 그 URL을 받아서 추가 대응.

## 2026-08-11 — 수동 zip 배포를 GitHub Release 자동 빌드로 전환

이번 세션 내내 코드 고칠 때마다 로컬에서 `npm run build` → zip → 카카오톡으로 전달을 반복했는데,
사용자가 "zip 빌드 멈추고 깃허브로 연동하자"고 요청. GitHub Actions로 자동화하기로 함(Chrome 웹
스토어 비공개 배포는 개발자 등록비/심사 필요해 보류 — Releases 자동화만 우선 진행하기로 사용자가 선택).

- **`.github/workflows/release-extension.yml`(신규)**: `main`에 `extension/**` 변경이 들어갈
  때마다(+ 수동 `workflow_dispatch`) `VITE_API_BASE_URL=https://sunnic-backend.onrender.com`로
  빌드 → `dist/`를 zip으로 압축 → `softprops/action-gh-release`로 **항상 같은 태그
  `extension-latest`를 덮어쓰며** GitHub Release에 `sunnic-extension.zip` 첨부. 매번 새 릴리즈를
  만드는 대신 하나를 계속 갱신해서, 팀원들이 버전 번호를 신경 안 쓰고 `releases/latest` 링크
  하나만 북마크해두면 항상 최신 zip을 받을 수 있게 함.
  `extension/dev-key.public.txt`가 저장소에 커밋돼 있어서(비밀키 아님, 확장 ID 고정용 공개키만)
  CI가 빌드해도 항상 같은 확장 ID(`chrome-extension://lakdhpgnlleljlkkfobckijbnojlplcf`)가
  나옴 — Render의 `ALLOWED_ORIGINS`를 다시 바꿀 필요 없음.
- `docs/deployment.md` 2~4단계를 로컬 빌드 안내에서 "Releases 페이지 링크 공유"로 갱신.
- 로컬에서 앞으로는 더 이상 수동으로 `sunnic-extension.zip`을 빌드/배포하지 않음 — 이 파일은
  gitignore된 로컬 산출물로 남지만, 실제 배포 소스는 GitHub Release로 이전.

### Next

- **Claude가 검증 불가능한 것**: 이 워크플로가 실제로 main 머지 시 정상적으로 돌아 Release가
  갱신되는지, 팀원들이 그 링크에서 zip을 정상적으로 받을 수 있는지 확인 필요 — `GITHUB_TOKEN`
  기본 권한으로 릴리즈 생성이 되는지는 실제 실행 전까진 100% 장담 못 함(조직 저장소 기본 설정에
  따라 Actions의 `contents: write` 권한이 막혀있을 가능성도 있음 — 그러면 워크플로 파일에
  `permissions: contents: write`을 이미 명시해뒀지만 그래도 실패하면 저장소 Settings →
  Actions → General에서 "Workflow permissions"를 Read and write로 바꿔야 함).

## 2026-08-11 — 진행률 체크리스트에 Logical Unit 세 번째 그룹 추가

사용자가 "진행바 UI에서 로지컬 유닛이 빠졌다"고 전달. 처음엔 "지금 구조엔 Logical Unit 자체가 없다"고
답했다가, "만든 사람이 있다는데?"라는 되물음에 다시 확인 — 부정확했음을 인정하고 코드로 재검증.

- **정정된 사실관계**: `bundled_screen_hybrid.review_document()`는 여전히 `Level.PARAGRAPH`/
  `Level.DOCUMENT` 청크만 모델에 직접 dispatch한다(Logical Unit 청크를 입력으로 주는 패스는 없음).
  하지만 `_CONFIRM_HYBRID_SYSTEM` 프롬프트가 confirm에게 `"level": "Logical Unit"`으로 승격 주장할
  권한을 명시적으로 주고, `resolve_reported_level`이 이를 받아들이면 **결과 Issue.level에 실제로
  "Logical Unit"이 찍힌다** — 패스로서는 없지만 결과 값으로는 실재함. `tiers.TIER_CATEGORIES`
  (rulebook §2 원본)에도 Logical Unit이 버젓이 한 위계로 올라가 있고, 8개 카테고리 전부를 커버함
  (Document는 AE 제외 7개, Paragraph는 GA 제외 7개 — Logical Unit만 전체를 커버).
- 사용자 요청: Paragraph/Document와 똑같은 방식으로 Logical Unit도 3번째 그룹으로 병렬(lockstep)
  진행하게 보여달라고 함.
- **`qa_jobs.py`**: `_PROGRESS_GROUPS`를 2개(paragraph/document) → 3개(document/logical_unit/
  paragraph)로 확장, 각 그룹을 `_RANGE_CATEGORIES`라는 이 파일 전용 ad-hoc 프로존셋 대신
  **`tiers.TIER_CATEGORIES`(원본 §2 매핑)로 직접 구성**하도록 `_build_tier_groups`를 재작성 — 이제
  진짜 rulebook 위계 테이블과 100% 일치한다. 카테고리 하나가 여러 그룹에 동시에 나타날 수 있음(예:
  LG는 Document/Logical Unit/Paragraph 셋 다에 나옴) — §2 자체가 다위계 룰을 허용하므로 정상.
  `_categories_for_progress`의 lockstep 채움 로직은 그룹 개수와 무관하게 이미 범용이라 코드 변경
  없이 3그룹에도 그대로 적용됨.
- 테스트 2개 추가: 그룹이 정확히 `["document","logical_unit","paragraph"]` 3개인지,
  logical_unit 그룹이 실제로 8개 카테고리 전부를 커버하는지. 검증: 백엔드 137개 전부 통과, ruff 클린.

### Next

- **Claude가 검증 불가능한 것**: 실제 QA 진행 화면에서 체크리스트가 Document/Logical Unit/
  Paragraph 3개 그룹으로 뜨고, 다같이 같은 속도로 차오르는지 확인 필요.
- Logical Unit엔 실제 dispatch 패스가 없어서 "진행 중" 표시가 진짜 API 호출과 무관한 완전 코스메틱
  값이라는 점은 기존 2그룹 때와 동일하게 유지됨 — 이 UI 전체가 원래 진짜 진행률이 아니었음(ADR 0001).

## 2026-08-11 — AE(모호한 표현)에도 MI와 같은 재검증 추가

알파테스트 재보고: MI뿐 아니라 AE도 과탐지 경향. MI/AE 재검증 방식 중 "AE에도 MI와 같은 재검증
추가"를 사용자가 선택.

- **`qa_jobs.py`**: `_verify_ae_finding(document_text, issue, llm)` 신규 — `_verify_mi_finding`과
  동일한 구조(문서 전체 재확인 후 `actually_ambiguous` bool)지만, AE 전용 시스템 프롬프트는
  AE-01/AE-04의 예외조건("문서 다른 곳에 정의/참조되면 예외")을 명시적으로 언급해 confirm이 좁은
  chunk만 보고 놓쳤을 그 참조를 다시 찾아보게 유도함. `_verify_mi_finding`/`_verify_ae_finding`을
  `_FALSE_POSITIVE_VERIFIERS: dict[str, Callable]`로 묶고, `_run_review_sync`의 필터링 로직을
  `rule.category != "MI"` 하드코딩에서 이 딕셔너리 조회로 일반화 — 카테고리 늘어날 때 딕셔너리에
  한 줄만 추가하면 됨. 나머지 카테고리로는 안 넓힘(문서 전체를 봐야 판단 가능한 예외조건을 가진
  건 이 둘뿐, 비용 문제도 있음 — 이유는 코드 주석에 남김).
- 테스트 5개 추가(MI 테스트와 대칭): `_verify_ae_finding` 4개(유지/드롭/LLM 에러 시 유지/malformed
  응답 시 유지) + `_run_review_sync`가 AE 오탐은 드롭하고 다른 이슈는 유지하는지.
- 검증: 백엔드 142개 전부 통과, ruff 클린.

### Next

- **Claude가 검증 불가능한 것**: 실제 AE 과탐지 사례(예: 3장에 정의된 수치를 참조한 4장 문구를
  "모호하다"고 잘못 판정하는 경우)가 재검증으로 실제로 걸러지는지 확인 필요.
- 이어서 사용자가 대량으로 재보고한 다른 이슈들(프레이밍 실패 재발/카테고리 오분류/재현성 문제 등)
  은 별도로 다룸 — 진행 중.

## 2026-08-11 — 진행바 정체 체감 완화 (tau 20s → 30s)

같은 대량 피드백 중 "80%까지는 빠르게 가다가 거기서 급 느려진다"는 항목 조사·조정.

- **원인**: 코드 버그가 아니라 `1 - exp(-elapsed/tau)` 점근곡선 자체의 수학적 특성 — tau=20일 때
  실측 완료 시점(~63.1초, 2패스 동시 실행 기준)까지 80%는 32초 만에 이미 도달해서, 남은 31초
  (전체 대기시간의 거의 절반)가 "80%→90%에서 정체 후 100%로 점프"하는 구간이었다.
- **`qa_jobs.py`**: `_ESTIMATED_DURATION_SECONDS` 20.0 → 30.0 — 80% 도달 시점이 48초로 늦춰져
  실제 완료 시점에 더 가까워짐(정체 체감 구간이 절반 가까이서 15초 안팎으로 줄어듦). t=63.1s일 때
  진행률은 여전히 ≈87%(tau=20 때 ≈86%와 거의 동일)라 "완료 훨씬 전에 90% 도달" 쪽 오차는 커지지
  않음 — 순수하게 완만한 방향으로만 개선.
- 여전히 근사치 상수라는 한계는 동일(실제 per-tier 진행 신호 없음, ADR 0001) — 문서 길이/GA-LG-LF
  후보 수에 따라 Document 패스가 유독 오래 걸리면 다시 조정 필요할 수 있음, 코드 주석에 남김.
- 검증: 백엔드 142개 전부 통과(이 상수를 직접 단언하는 테스트는 없어서 영향 없음), ruff 클린.

### Next

- **Claude가 검증 불가능한 것**: 실제 QA 진행 화면에서 정체 체감이 실제로 줄어드는지 확인 필요 —
  이 조정도 여전히 근사치라 완전히 사라지진 않음, 사용자도 "해결 안 해도 되는 부분일 수 있다"고
  낮은 우선순위로 표시했었음.

## 2026-08-11 — 수정 저장 유사도 검사를 글자 비교에서 LLM 의미 판단으로 교체

"기획자들이 수정 버튼 한 번 누를 때 되게 신중한데, 표현이 AI 제안과 다르면 무조건 경고가 뜬다"는
사용자 지적 — `difflib.SequenceMatcher`(글자 단위)는 지시형 제안("~할 것을 고려해보세요")처럼
애초에 붙여넣을 문구가 아닌 경우, 사람이 아무리 정확하게 고쳐도 항상 낮은 유사도가 나온다는
근본 한계가 있었음. LLM이 의미로 판단하는 방식으로 교체하기로 사용자가 선택.

- **`issues.py`**: `POST /issues/similarity-check`가 이제 `difflib` 대신 저비용 모델(Haiku)에게
  원문/검증기준/검증이유/AI 제안/사용자 실제 수정본을 다 주고 "이 수정이 검증기준을 실질적으로
  만족시키는가"를 직접 묻는다. 응답 스키마도 `{similarity, matches_closely}` → `{addresses_issue,
  reason}`으로 변경(가짜 퍼센트 대신 LLM이 준 실제 이유 문장을 보여줄 수 있게). 판단 실패/malformed
  응답 시 `addresses_issue: True`로 fail-open — 이 검사는 안전장치일 뿐 필수 게이트가 아니므로
  저장을 막지 않음(MI/AE 검증과 동일한 fail-open 철학).
- **확장(`api/types.ts`/`client.ts`/`IssueListScreen.tsx`)**: `checkEditSimilarity`가 이제
  `originalText`/`criteria`/`reason`/`suggestion`/`editedText` 5개를 다 보냄(기존엔 suggestion/
  editedText 2개뿐). 경고 문구도 가짜 퍼센트 대신 LLM이 준 `reason`을 그대로 보여줌
  (`AI 제안과 다소 달라요` 폴백은 reason이 비어있을 때만).
- 테스트: 백엔드 5개 재작성(통과/드롭/fail-open 2종/프롬프트에 검증기준·검증이유가 실제로
  포함되는지 확인). 검증: 백엔드 144개, 확장 89개 전부 통과, typecheck/lint/build 클린.
- 엔드포인트 경로(`/issues/similarity-check`)는 의미가 바뀌었지만 내부 전용 API라 혼선 비용이
  크지 않다고 보고 그대로 유지 — 이름과 실제 동작(더 이상 "유사도"가 아님)이 안 맞는 건 알려진
  사소한 불일치로 남김.

### Next

- **Claude가 검증 불가능한 것**: 실제로 지시형 제안(예: MI형 "~를 추가하세요")에 대해 표현이 다른
  정확한 수정을 저장할 때 더 이상 불필요한 경고가 안 뜨는지, 반대로 진짜 안 고친 경우엔 여전히
  잘 걸러지는지 확인 필요.
- 저장 1회당 API 호출이 1콜 늘어남(Haiku, 저비용이지만 0은 아님) — 사용량이 늘면 비용 재점검.

## 2026-08-11 — planqa-agent 재벤더링: GA/TC/MI 카테고리 경계 프롬프트 보강

`sunic5-planqa/planqa-agent` 이슈 [#26](https://github.com/sunic5-planqa/planqa-agent/issues/26)
(방금 이 세션에서 올린 것, GA↔TC/TC↔MI 오분류)에 대응해 upstream이 PR
[#27](https://github.com/sunic5-planqa/planqa-agent/pull/27)로 프롬프트만 수정 — 정확히 이슈
코멘트에서 요청한 "저비용 경로"(시그니처/모듈명/LLMClient 계약 안 건드림) 그대로 따라줌.

- **원인(upstream 분석)**: `_hybrid_block`이 룰별 텍스트만 보여주고 카테고리 자체의 "한줄정의"는
  안 보여줘서, "두 문장이 다르다"는 표면 패턴만으로 GA(내용 충돌)와 TC(표기 불일치)를 헷갈리기
  쉬웠음. `global_context`도 용어집이 아니라 요약이라, 재표현된 기존 용어를 "새 개념"으로 오인해
  MI로 새는 것으로 추정.
- **`bundled_screen_hybrid.py`**: `_CATEGORY_BOUNDARY_NOTES`(GA-vs-TC, TC-vs-MI 경계 설명 두
  문단) 신규 상수 추가, `_SCREEN_HYBRID_SYSTEM`(1차 분류가 일어나는 곳)과
  `_CONFIRM_HYBRID_SYSTEM`(confirm이 잘못 태깅된 후보를 rule_id 재할당은 못 해도 최소
  violated=false로 거부는 할 수 있는 2차 방어선) 양쪽에 삽입. 재벤더링 diff는 순수 import 경로
  차이(`planqa_review.` → `sunnic_backend.qa_engine.review_agent.`) 외엔 이 프롬프트 추가분뿐 —
  다른 파일은 하나도 안 건드림, `.env`도 그대로 유지.
- upstream이 사례3(낮은 재현율)·사례4(비결정성)는 재현 가능한 입력이 없어서 이번엔 손 못 댔다고
  명시 — 이슈는 계속 열어둠, 유사 사례 나오면 원문과 함께 다시 리포트하기로 함.
- 검증: 백엔드 144개 전부 통과(프롬프트 텍스트 변경이라 신규 테스트는 추가 안 함, upstream도
  123/123으로 이미 확인), ruff 클린.

### Next

- **Claude가 검증 불가능한 것**: 실제 알파테스트에서 GA/TC/MI 오분류 사례가 줄어드는지 확인
  필요 — upstream도 재현 입력이 없어 라이브 검증을 못 했다고 명시했음, 다음 실사용 관찰이 사실상
  첫 검증.

## 2026-08-11 — 이슈 위치 넘버링(1-a, 2장 형식) 구현

지난번 피드백 5번("1-a, 2장처럼 넘버링 표기가 안 됨") — 원문 헤딩 자체에 번호가 있든 없든
작성자마다 제각각이라 신뢰할 수 없다는 게 이번 세션에서 여러 번 확인됨. "본문 상단 소주제부터
등장 순서로 우리가 직접 번호를 매기자"는 사용자 제안대로 구현.

- **`qa_jobs.py`**: `_build_heading_numbers(document_text)` 신규 — 벤더링된 `document.py`의
  `parse_document()`를 그대로 호출해(그 파일 자체는 안 건드림) `tree.logical_units`를 문서 등장
  순서로 "1", "2", ...로, 각 유닛 하위의 `tree.paragraphs`(h3~h6 헤딩)를 그 유닛 안에서의 순서로
  "1-1", "1-2", ...로 번호 매김. `Chunk.location` 문자열(원문 헤딩 텍스트 그대로, 예: "배경" 또는
  이미 "1. 배경"처럼 작성자가 번호를 붙인 경우도 포함)을 키로 쓰는 dict라, `Issue.location`과
  정확히 같은 문자열로 조회된다. Document 위계 이슈(location=페이지 제목)는 이 dict에 없어서
  `location_number`가 자연히 `None`으로 나옴 — 문서 제목엔 번호를 안 붙이는 게 맞는 동작.
- **`models/issue.py`/`qa_jobs.py`**: `IssueRecord`/`IssueResponse`에 `location_number: str | None`
  필드 추가. `_execute_qa_job`이 문서당 한 번만 `_build_heading_numbers`를 계산해 모든 이슈에
  재사용(이슈마다 다시 파싱하지 않음).
- **확장**: `utils/locationLabel.ts`(신규) — `formatLocationLabel(location, locationNumber)` 순수
  함수. `location_number`가 있으면 원문 텍스트에 이미 붙어있는 번호(정규식으로 감지 — 숫자 뒤에
  바로 마침표/공백이 와야 "번호"로 인정, 그냥 `\d+`만으로는 "2024년 정책"의 "2024"까지 오탐해서
  걷어내 버림)를 걷어내고 우리 번호로 교체, 없으면 원문 그대로. `IssueListScreen.tsx`의
  `.issue-location`에 적용.
- 테스트: 백엔드 4개(로직 유닛 순서 번호, 작성자 자체 번호와 무관하게 계산, 하위 헤딩 "N-M" 형식,
  API 응답에 실제로 흘러들어가는지) + 확장 6개(`formatLocationLabel` 순수함수 유닛 테스트, 특히
  "2024년" 같은 假번호 오탐 방지 케이스). 검증: 백엔드 148개, 확장 95개 전부 통과,
  typecheck/lint/build 클린.

### Next

- **Claude가 검증 불가능한 것**: 실제 컨플루언스 문서에서 "1", "2-1" 같은 번호가 카드에 정확히
  붙는지, 작성자가 이미 번호를 붙인 문서에서 중복 표기 없이 잘 나오는지 확인 필요.

## 2026-08-11 — 프레이밍 진단 로그, edit-v2 중복 버그 수정, QA완료 뒤 뒤로가기

3명 다 "게시 후(보기) 화면"에서도 하이라이트가 하나도 안 뜬다는 재보고 — 편집기(edit-v2) 가설은
기각됨. 원인 후보를 좁힐 데이터가 없어서(이전에도 목록/표 합성기호, 엔티티 인코딩 등 재현 데이터
없이는 못 고쳤음) 다음 재현 시 바로 진단 가능하도록 로그부터 남기고, 같이 발견된 실제 버그와
9번(QA완료 뒤 뒤로가기)을 먼저 처리.

- **`issueOverlay.ts`**: `wrapIssue()`가 본문 매칭에 실패하면(폴백으로 넘어가기 전) 콘솔에 실패
  정보를 남기는 `logFramingMatchFailure()` 추가 — `logStorageMatchFailure`(저장 실패용)와 같은
  패턴. input_text 앞부분조차 못 찾았는지, 앞부분은 찾았는데 전체 매칭만 실패했는지 구분해서 남김.
- **실제 버그 발견·수정**: 같은 파일 안에 `confluence-extractor.ts`와 별도로 복제해둔
  `extractPageId()`(콘텐츠 스크립트 간 리스너 중복 등록을 피하려고 의도적으로 복제된 것)에
  지난번 고친 edit-v2 URL 인식 수정이 반영 안 돼 있었음 — 저장(복제본 생성/PUT) 플로우가 새
  편집기 초안 URL에서 여전히 실패했을 것. 같은 정규식으로 동기화, 회귀 테스트 추가.
- **`HistoryExportScreen.tsx`**: "QA 완료" 눌러서 온 뒤 마음이 바뀌어 이슈를 더 보고 싶을 수
  있다는 피드백(9번) — "← 이슈 목록으로" 링크를 "검토 종료" 버튼 위에 추가, 이슈 화면으로 돌아가면
  기존 `currentIssueIndex` 등 상태가 그대로라 보던 자리에서 이어짐.
- **6번(관계형 이슈 두 위치 편집)**: 조사해보니 모델이 두 번째 위치(`related_location`)의 실제
  인용문을 안 줘서(라벨만 줌) 우리 쪽에서 "수정 저장"을 두 번째 위치에도 만들 방법이 없음 —
  planqa-agent에 `related_original_text` 필드 추가를 요청하는 이슈
  [#29](https://github.com/sunic5-planqa/planqa-agent/issues/29) 등록, upstream 대응 대기.
- 검증: 확장 96개(신규 1개 포함) 전부 통과, typecheck/lint/build 클린. 백엔드 변경 없음.

### Next

- **Claude가 검증 불가능한 것**: 프레이밍 0매칭이 다음에 또 재현되면, 이번에 추가한 콘솔 로그
  (`[SunniC] input_text 앞부분조차 본문에서 찾지 못함` 등)를 그대로 캡처해서 전달받아야 실제
  진단이 가능함 — 아직 원인 자체는 못 찾음, 로그 인프라만 준비된 상태.
- planqa-agent#29(related_original_text) upstream 대응 대기 — 받으면 재벤더링 + 프론트에 두 번째
  위치 편집 UI 추가 필요.

## 2026-08-11 — planqa-agent 재벤더링(related_original_text) + 관계형 이슈 두 위치 편집 UI

이슈 [#29](https://github.com/sunic5-planqa/planqa-agent/issues/29) 요청이 예상보다 훨씬 빨리
처리됨(PR [#30](https://github.com/sunic5-planqa/planqa-agent/pull/30), "middle-cost" 등급으로
직접 분류해서 대응). 재벤더링하고 바로 프론트 편집 UI까지 완성.

- **재벤더링**: `planqa_schemas/schema.py`에 `related_original_text: str | None = None` 필드
  (related_location과 같은 자리·조건), `bundled_screen_hybrid.py`의 confirm 프롬프트가 관련
  위치의 정확한 인용문도 요청하도록 보강 + 파싱에서 채움. 순수 필드 추가라(시그니처/모듈명 변경
  없음) diff는 import 경로 차이 외엔 이거뿐. 벤더링된 테스트(`test_bundled_screen_hybrid.py`)도
  upstream과 동일하게 2개 갱신(비관계형 카테고리는 무시하는지, 관계형은 채워지는지).
- **백엔드**: `IssueRecord`/`IssueResponse`에 `related_original_text` 스레딩.
- **확장 — 두 위치 독립 편집**: `IssueEdit`에 `relatedEditedText` 필드 추가, `STAGE_ISSUE_EDIT`
  액션에 `target: 'primary' | 'related'` 파라미터 추가해 한쪽을 저장해도 다른 쪽에 이미 저장해둔
  게 안 지워지게 함. `IssueListScreen.tsx`에 "관련 위치 원문" 블록 신규(관계형 이슈 +
  related_original_text 있을 때만) — 자체 "오류 수정하기"/저장 흐름을 가짐. 관련 위치는 AI
  "제안"이 따로 없어서(원문에서 직접 고치는 게 목적) 유사도 LLM 판단 검사는 건너뛰고 로컬 "원래
  문구가 남아있는지" 체크만 함.
- **알려진 스코프 제한**: 히스토리 화면(`HistoryExportScreen.tsx`)의 원본/수정본 비교 목록은
  아직 primary 편집만 보여줌 — related 편집은 반영 안 됨. 편집 중엔 두 위치 중 하나만 동시에
  열 수 있음(같은 `editingIssueId`를 공유). 저장 후 자동으로 다음 이슈로 넘어가는 동작은 두
  위치 다 안 고쳐도 그대로 유지 — "이전"으로 돌아와 나머지를 마저 고치면 됨.
- 테스트: 백엔드 149개(스키마/전달 경로), 벤더링 테스트 8개, 확장 98개(신규: appReducer의
  STAGE_ISSUE_EDIT 독립성 2개) 전부 통과. typecheck/lint/build 클린.

### Next

- **Claude가 검증 불가능한 것**: 실제 GA/LG/LF 이슈에서 "관련 위치 원문" 블록이 정확한 문구로
  뜨고, 독립적으로 편집·저장되는지 확인 필요.
- HistoryExportScreen에 related 편집 반영은 다음 과제로 남김.

## 2026-08-12 — 여러 불릿을 이어붙인 인용문의 매칭 실패 수정

"원문에서 해당 문구를 찾지 못했습니다" 재보고 — 이번엔 어제 추가한 진단 로그 덕분에 바로 원인
특정. 처음엔 옛날 버전 확장(빌드 해시가 여러 수정 이전 것)인 줄 알았는데, 최신 zip으로 재설치한
뒤에도 같은 문구(`probe: "- 쿠폰 적용 주문의 구매 "`, `oldTextLength: 219`)로 재현됨 — 실제로는
다른 버그였음.

- **원인**: `stripMarkdownArtifacts`가 불릿 접두사("- ")는 줄 단위로 잘 걷어내지만, **불릿과
  불릿 사이의 줄바꿈**은 여전히 `buildLooseTextRegex`의 일반 공백 처리(`\s+`, 1개 이상 요구)를
  탔다 — 표 셀 사이 파이프에서 이미 겪었던 것과 같은 문제로, 실제 문서에서 인접한 `<li>` 사이에
  공백 문자가 전혀 없으면(흔함) `\s+`가 매칭을 거부한다. 219자짜리 긴 input_text는 불릿 여러 줄을
  통째로 인용한 경우였을 가능성이 높음.
- **`issueOverlay.ts`**: `buildLooseTextRegex`에서 줄바꿈(`\n`)을 일반 공백과 분리해서 먼저
  `\s*`(0개 이상)로 느슨화하고, 그 다음 남은 일반 공백만 `\s+`(1개 이상)로 처리하도록 순서 변경.
  줄바꿈 경계는 아예 없을 수도 있다고 보고, 문장 내부 공백은 최소 1개는 있다고 보는 구분.
- 회귀 테스트 2개 추가: `applyIssueOverlay`(본문 하이라이트)와 `applyIssueEdit`(저장) 양쪽에서
  `<li>` 사이 공백이 0인 두 줄짜리 불릿 인용문이 정상 매칭되는지.
- **참고**: 이 진단 과정에서 사용자가 처음 보낸 로그는 실제로 옛날 빌드(해시 `COM0H1uG`, 오늘 세션
  이전 수정사항이 전혀 없는 버전)였음 — "최신 zip으로 재설치했는데도 안 됨"이라는 후속 보고(해시
  `B8925RMF`, 최신)가 없었다면 이 버그를 놓칠 뻔함. 진단 로그의 `probe`가 스트리핑 *전* 원본
  기준이라 "옛 버전이라 그런가 보다"로 오판하기 쉬웠던 점도 기록.
- 검증: 확장 100개(신규 2개 포함) 전부 통과, typecheck/lint/build 클린. 백엔드 변경 없음.

### Next

- **Claude가 검증 불가능한 것**: 이 사용자의 실제 문서에서 재현 후 "수정 저장"이 이제 정상 작동
  하는지 확인 필요.
- 같은 클래스의 "인접 블록 요소 사이 구분자 없음" 문제가 다른 조합(예: `<p>` 사이, 중첩 목록)에서
  또 나올 수 있음 — 계속 재현 보고가 오면 로그(`probe`는 스트리핑 전 원본임을 감안하고 판단)로
  진단.

## 2026-08-12 — 중첩 목록 이중 평탄화 버그 수정 (진짜 원인 찾음)

바로 위 항목("여러 불릿 이어붙인 인용문" 수정)이 이 케이스의 진짜 원인이 아니었음이 재현 보고로
확인됨. 처음엔 옛날 빌드 문제로 오판했다가, 최신 빌드(`ClGkDPoH`)로도 재현되는 걸 보고 실제
문서를 MCP로 가져와 봤는데 — 내가 추측했던 이어지는 문장("구매 확정 여부와 무관하게...")이
실제 문서 어디에도 없어서 "모델 할루시네이션"으로 다시 오판했었음. 사용자가 사이드패널
스크린샷(입력내용/검증기준/검증이유 전체)을 보내준 뒤에야 진짜 원인이 드러남 — 두 번의 잘못된
가설을 거쳐야 했던 케이스.

- **실제 원인**: `gy30356635.atlassian.net`의 실제 문서("3. 성공 지표")에 `<li>` 안에 `<ul>`이
  중첩된 구조(불릿 안에 하위 불릿 "측정 기간"/"산정 방법")가 있었는데, `confluenceParser.ts`의
  `node.querySelectorAll('li')`가 **하위 li까지 깊이 상관없이 전부** 가져와버렸다. 그 결과: (1)
  상위 li의 `.textContent`가 자기 텍스트와 하위 목록 텍스트를 구분자 없이 통째로 이어붙인 뭉갠
  문장을 만들고, (2) 그 하위 항목들이 querySelectorAll에 또 걸려서 별도 줄로 한 번 더 나왔다 —
  **백엔드로 보내는 문서 텍스트 자체에 진짜 중복이 생긴 것**. QA 엔진(RD-02 불필요한 중복)이 이걸
  정확하게 잡아냈지만(오탐 아님!), 그 중복의 절반(두 번째 반복)은 실제 라이브 문서엔 없는
  텍스트라 "수정 저장" 단계에서 원문을 못 찾았다.
- **`confluenceParser.ts`**: `flattenListItems(listNode)` 신규 — `:scope > li`로 **직계 자식만**
  순회하고, 각 `<li>` 자신의 텍스트는 중첩된 `<ul>/<ol>`을 제거한 clone에서 뽑아 뭉개짐을 막고,
  중첩 목록은 재귀 호출로 그 뒤에 이어서 정확히 한 번만 남긴다.
- 회귀 테스트: 실제 재현된 구조 그대로(문제의 그 3개 항목 형태) 이중 평탄화 없이 각 항목이
  정확히 한 번씩만 나오는지 확인.
- **반성**: 두 번이나 데이터 없이 추측(멀티불릿 줄바꿈, 모델 할루시네이션)해서 틀렸다 — 실제
  사이드패널 데이터(입력내용/검증기준/검증이유)를 처음부터 요청했으면 한 번에 맞는 진단이
  가능했을 사례. 콘솔 로그의 `probe`는 15자뿐이라 추측의 근거로 쓰기엔 항상 부족했음.
- 검증: 확장 101개(신규 1개 포함) 전부 통과, typecheck/lint/build 클린. 백엔드 변경 없음(프론트
  파싱 단계 버그).

### Next

- **Claude가 검증 불가능한 것**: 이 문서(NxEF 쿠폰/프로모션 PRD)를 최신 zip으로 다시 QA 돌렸을
  때 "3. 성공 지표"의 RD 이슈가 사라지거나(진짜 중복이 없어졌으니), 다른 정당한 이슈로 바뀌는지,
  그리고 다른 이슈들의 "수정 저장"이 정상 작동하는지 확인 필요.
- 중첩 목록이 3단 이상 깊이일 때도 동일하게 안전한지는 재귀 구조상 이론적으론 되지만 실제
  데이터로 검증은 안 됨.

## 2026-08-12 — MI(정보 누락) 이슈도 직접 편집 가능하게 (삽입 모드)

"이렇게 다 떠서 수정이 안 되는데 너무 불편하다"는 실사용 피드백 — MI형 이슈는 지금까지 편집을
아예 막아뒀는데(원문에 없는 내용이라 "치환" 방식이 안 맞아서), 이게 이슈의 상당수를 차지해서
체감 불편함이 컸음. 7번 피드백(노션 문서 참고한 정밀 프레이밍)은 여전히 문서를 못 받아 보류
중이지만, 그거 없이도 지금 당장 만들 수 있는 실용적인 버전을 먼저 구현.

- **`issueOverlay.ts`**: `insertParagraphAfterHeading(html, headingLabel, newText)` 신규 —
  storage HTML에서 `issue.location`이 가리키는 헤딩(`<h2>~<h6>`)을 찾아 그 닫는 태그 바로 뒤에
  `<p>newText</p>`를 새 문단으로 끼워 넣는다. 정밀한 "어느 문장 뒤"까지는 못 정하지만, 최소한
  해당 섹션 안에 자동으로 들어가서 사람이 확인만 하면 되는 수준까지는 만들어줌.
  `applyIssueEdit(issueId, oldText, newText, mode)`에 `mode: 'insert'` 추가 — 치환
  (`replaceTextAndSave`) 대신 삽입(`insertContentAndSave`) 경로를 탄다. 삽입 모드에서는 헤딩
  자체의 표시 텍스트는 안 바꾸고(제목이 바뀐 것처럼 보이면 오해를 주므로) 완료 테두리만 표시.
- **`messages.ts`**: `ApplyIssueEditRequest`에 `mode?: 'replace' | 'insert'` 추가(생략 시 기존
  치환 동작 그대로 — 하위 호환).
- **`IssueListScreen.tsx`**: MI형 이슈에서도 "수정제안" 박스가 "추가할 내용"/"내용 추가하기"로
  라벨만 바뀐 채 똑같이 편집 가능해짐(그동안 막혀있던 `isEditing` 게이트 제거). 저장 시
  `mode: 'insert'`로 보내고, 비교 기준(원문/AI 제안)이 없는 삽입·관련위치 편집은 유사도 LLM
  검사를 건너뜀(이미 있던 'related' 타깃 처리와 동일한 방식으로 통합).
- 테스트: 확장 3개 추가(삽입 성공/헤딩 텍스트 안 바뀜/대상 섹션 못 찾으면 명확한 에러). 검증:
  확장 104개 전부 통과, typecheck/lint/build 클린. 백엔드 변경 없음.

### Next

- **Claude가 검증 불가능한 것**: 실제 MI 이슈에서 "내용 추가하기"로 저장했을 때 컨플루언스
  복제본의 정확한 위치(섹션 제목 바로 아래)에 새 문단이 잘 들어가는지 확인 필요.
- 여전히 "노션에 정리된 프레이밍 방법"을 못 받아서, 이번 구현은 그 정식 스펙과 다를 수 있음 —
  문서 받으면 이 구현을 그 기준으로 다시 다듬어야 할 수 있음(임시방편으로 명시).
- 헤딩 바로 아래가 아니라 "그 섹션의 어느 문장 뒤"까지 정밀하게 지정하는 건 여전히 스코프 밖.

## 2026-08-12 — 삽입 모드에도 원본 화면 시각 피드백 추가

"추가할 내용이 추가가 안 된다"는 재보고 — 실제로는 저장(복제본 생성+PUT) 자체는 됐는데, 치환
모드(`overwriteMarkText`)와 달리 삽입 모드는 원본 페이지 화면에 아무 시각적 변화가 없어서
"안 됐다"로 오인됐던 것으로 파악됨(사용자가 직접 확인: "원래는 원본 오버레이 화면에서도 바뀐 게
떴었어").

- **`issueOverlay.ts`**: `insertLiveParagraphAfterHeading(issueId, newText)` 신규 —
  `overwriteMarkText`가 기존 텍스트를 새 텍스트로 덮어쓰는 것과 대칭으로, 삽입 모드는 덮어쓸
  대상이 없으니 대신 **헤딩 바로 뒤에 저장된 것과 같은 문단을 실제로 그려 넣는다**(`✓
  삽입됨(복제본에 저장됨)` 라벨이 붙은 초록 테두리 박스, 신규 CSS 클래스
  `.sunnic-issue-inserted`). 실제 저장 대상(복제본)과는 무관한 순수 로컬 DOM 표시일 뿐이지만,
  이제 치환 모드와 똑같이 "저장이 실제로 반영됐다"는 걸 원본 화면에서도 바로 확인할 수 있음.
- 회귀 테스트 추가: 삽입된 문단이 헤딩의 바로 다음 형제 요소로(기존 콘텐츠보다 앞에) 정확히
  들어가는지.
- 검증: 확장 105개(신규 1개 포함) 전부 통과, typecheck/lint/build 클린. 백엔드 변경 없음.

### Next

- **Claude가 검증 불가능한 것**: 실제 MI 이슈에서 "내용 추가하기" 저장 시 원본 화면에도 초록
  박스가 바로 뜨고, 복제본에도 실제로 반영되는지(검색으로 복제본 존재 확인 포함) 재확인 필요 —
  아직 저장 자체가 정말 성공했었는지(복제본 생성 여부)는 사용자가 직접 검색으로 확인 못 한 상태.

## 2026-08-12 — 서비스명 "똑독", 로고 교체

브랜드를 "써니C"/"AI QA Service"에서 "똑독"으로 변경, 사용자가 준 로고(발바닥+돋보기 그라데이션
아이콘)로 확장 아이콘 전체 교체. 서비스명 표기는 "똑독 ㅣ 서비스 기획서 품질 검증 도우미"(세로바
구분) 형태로 확정.

- **로고**: `public/icons/icon{16,48,128}.png` 전부 새 이미지로 교체(원본 188×188 → sips로
  각 사이즈 리사이즈, 알파 채널 보존 확인).
- **`manifest.config.ts`**: `name`을 `'똑독 ㅣ 서비스 기획서 품질 검증 도우미'`로 변경(확장
  관리 페이지·설치 화면에 뜨는 정식 이름).
- **`sidepanel/index.html`**: `<title>`을 `'똑독 ㅣ 기획서 QA'`로 변경.
- **패널 안 표기(6개 화면 h1 "panel-title" + MainScreen의 "OO으로 N건의 문서가 검토됐어요" 브랜드
  스팬)**: 좁은 패널 폭에 맞춰 짧게 "AI QA Service" → "똑독"으로 통일.
- 검증: 확장 105개 전부 통과(브랜드 문구를 단언하는 테스트 없어서 영향 없음), typecheck/lint/build
  클린, `dist/manifest.json`에 새 이름·아이콘 경로 반영 확인.

### Next

- **Claude가 검증 불가능한 것**: 실제 `chrome://extensions`에 로드했을 때 새 로고/이름이 카드에
  정확히 뜨는지, 사이드패널 안에서도 자연스러워 보이는지 확인 필요.
- "써니C"라는 이름이 `docs/`의 과거 진행 기록·ADR·README 등 프로젝트 문서 전반에 여전히 남아있음
  — 이번 변경은 사용자가 명시적으로 지목한 확장 UI/로고 범위로 한정, 문서 전체 리네이밍은 별도
  요청 시 진행.

## 2026-08-12 — MI 삽입 모드 되돌림 + QA 리뷰 결과 캐시 제거

"추가가 계속 뜨는데 적용이 안 된다"는 재보고 끝에 사용자가 삽입 모드 자체를 되돌리고 기존
치환(수정) 방식으로만 동작하게 해달라고 요청 — 여러 차례 디버깅해도 안 되는 걸 계속 붙잡고
있느니, 검증된 기존 동작으로 되돌리는 쪽을 선택. 같이 요청받은 QA 리뷰 결과 캐시 제거도 진행 —
돌아보니 이게 그동안 "고쳤는데 왜 반영이 안 되냐"는 여러 혼란의 실제 원인이었을 가능성이 큼(문서
텍스트가 그대로면 프롬프트/코드를 아무리 고쳐도 서버 재시작 전까진 캐시된 옛날 결과가 계속
나갔음 — MI/AE 검증 추가, GA/TC/MI 경계 프롬프트 등 문서 내용과 무관한 백엔드 변경들이 전부 이
캐시에 가려졌을 수 있음).

- **`git revert`로 되돌림**: `feat: allow editing MI issues via insert mode`(#73),
  `fix: show inserted paragraph on original page for MI edits`(#75) 두 커밋 정확히 원복 —
  `issueOverlay.ts`(insertParagraphAfterHeading/insertContentAndSave/insertLiveParagraphAfterHeading/
  `.sunnic-issue-inserted` 스타일), `messages.ts`(mode 필드), `IssueListScreen.tsx`(삽입 모드
  전용 라벨/분기) 전부 제거 — MI 이슈는 다시 "문서에 없는 내용을 추가하라는 안내라, 자동으로
  반영할 수 없어요" 메시지만 뜨고 편집 불가한 예전 상태로.
- **`qa_jobs.py`**: `_review_cache`/`_document_cache_key` 완전 삭제, `_execute_qa_job`이 항상
  `_run_review_sync`를 새로 호출. 미사용된 `hashlib` import도 제거.
- 테스트: 캐시 재사용을 검증하던 `test_qa_job_reuses_cached_result_for_identical_document_text`를
  정반대 기대값(캐시 없이 매번 새로 호출됨, `call_count == 2`)으로 재작성 —
  `test_qa_job_does_not_use_cache_for_a_different_document`는 이제 사실상 같은 걸 검증하게 돼서
  통합. `_clear_review_cache` 오토유즈 픽스처도 대상이 없어져 제거.
- 검증: 백엔드 148개, 확장 101개(삽입 모드 관련 4개 자연히 사라짐) 전부 통과, 양쪽
  typecheck/lint/build 클린. 되돌린 뒤 확장 빌드 해시(`issueOverlay.ts-ClGkDPoH.js`)가 삽입 모드
  추가 이전 빌드와 정확히 일치 — 완전한 원복 확인.

### Next

- **Claude가 검증 불가능한 것**: 캐시 제거 후 같은 문서를 다시 QA 돌렸을 때 매번 실제로 새
  리뷰가 도는지(응답 시간으로 체감), 그리고 그동안 캐시에 가려져 있었을 수 있는 백엔드 수정
  (MI/AE 검증, GA/TC/MI 프롬프트 등)들이 이제 실제로 반영되는지 확인 필요.
- MI형 이슈 편집은 다시 막힌 상태 — 노션 문서(정밀 프레이밍 스펙)를 받으면 그 기준으로 처음부터
  다시 설계해서 붙이는 게 나을 듯.

## 2026-08-12 — 1차 스크리닝 모델을 Claude Haiku → Gemini Flash-Lite로 전환

비용 절감 목적으로 1차 스크리닝(screen_llm)을 Gemini Flash-Lite로 바꿔달라는 요청. planqa-agent에
`llm/gemini.py`가 이미 있어서(우리가 처음 벤더링할 때 "안 쓴다"고 스킵만 했을 뿐 upstream엔 계속
있었음, ADR 0001 최초 Context 참고) 새로 만들 것 없이 그대로 벤더링. `google-genai` 의존성과
`config.py`의 `gemini_api_keys` 파싱도 review-agent 벤더링 이전 초기 스캐폴드 시절부터 이미
남아있던 것이라(당시 1차 스크리닝을 Gemini로 하려던 원래 설계) 추가 설정 없이 바로 재사용 가능했음.

- **`llm/gemini.py`(재벤더링)**: `GeminiClient` — `AnthropicClient`와 같은 `LLMClient.
  complete_json` 프로토콜이라 `instrumentation.isolate_client()`가 `.isolate()` 없는 클라이언트에
  대해 이미 갖고 있던 duck-type 폴백(`copy.copy()` + 새 usage 리스트)이 코드 변경 없이 그대로
  적용됨 — 여러 Gemini API 키 라운드로빈 상태(`_current`/`_current_lock`)는 그 얕은 복사에서
  의도적으로 참조 공유되도록 이미 설계돼 있음(클래스 자체 주석 참고).
- **`config.py`**: `sunnic_gemini_model: str = "gemini-flash-lite-latest"` 추가(upstream
  `DEFAULT_MODEL`과 동일 값).
- **`qa_jobs.py`**: `screen_llm`을 `GeminiClient(model=settings.sunnic_gemini_model,
  api_keys=settings.gemini_api_keys)`로 교체, `confirm_llm`(Sonnet, 2차)은 그대로. MI/AE
  재검증·유사도 검사는 이 요청 범위 밖이라 계속 Haiku 사용.
- **`render.yaml`/`.env.example`**: `GEMINI_API_KEYS`(비밀, 수동 설정), `SUNNIC_GEMINI_MODEL`
  추가.
- **`pyproject.toml`**: 벤더링 파일 lint 예외 목록에 `I001`(import 정렬) 추가 — upstream의
  import 줄바꿈 관례가 우리 것과 달라서, 재벤더링할 때마다 다시 안 맞을 걸 알면서 손대는 대신
  기존 `B023`/`C408`/`UP047`와 같은 이유로 예외 처리.
- 테스트: `screen_llm`이 이제 Gemini를 쓰므로, 기존에 `AnthropicClient`만 목킹하던 모든 테스트
  (`FakeAnthropicClient`)에 `GeminiClient`도 같이 목킹하도록 6곳 추가 — 안 그러면 로컬 `.env`에
  실제 키가 있어서 테스트가 조용히 진짜 Gemini API를 호출하는 사고가 날 뻔했음(실제로 최초 실행
  때 발생 확인, 네트워크 의존적이라 CI/다른 개발자 환경에선 아예 실패했을 것). `FakeAnthropicClient`
  생성자를 키워드 전용 `**_kwargs`로 일반화해서 `AnthropicClient(api_key=...)`/`GeminiClient(
  api_keys=...)` 두 시그니처 모두에 그대로 쓸 수 있게 함.
- 검증: 백엔드 148개 전부 통과, ruff 클린.

### Next

- **Claude가 검증 불가능한 것**: 실제 QA 실행에서 스크리닝이 Gemini로 정상적으로 도는지(응답
  속도/품질 변화 포함), Render 프로덕션에 `GEMINI_API_KEYS`를 아직 안 넣어서 배포 환경에선 이
  키를 설정하기 전까지 QA 작업이 실패할 것 — 사용자가 Render 대시보드에서 직접 추가해야 함.
- Gemini 무료 티어 쿼터(키당 최소 RPM/일일 요청 매우 낮음)에 걸리면 `GeminiClient`가 여러 키를
  라운드로빈하며 재시도하는데, 키를 하나만 등록해두면 그 재시도 로직이 무의미해짐 — 여러 키를
  콤마로 등록해두는 걸 권장.

## 2026-08-12 — 배포 QR코드 + zip 안에 설치법 동봉

비개발자 5명에게 배포할 때 GitHub 링크 대신 QR코드로 받게 하고 싶다는 요청 — GitHub Releases의
zip 직링크(`releases/download/extension-latest/sunnic-extension.zip`)로 QR 생성. 이 링크는
`extension-latest` 태그를 계속 덮어쓰는 방식이라 고정이라, 확장이 업데이트돼도 QR을 다시 만들
필요 없음.

- QR코드 생성: Python `qrcode` 패키지(스크래치 venv에 임시 설치)로 생성 후 OpenCV로 디코드까지
  재확인(실제로 그 URL로 정확히 스캔되는지 검증).
- **`extension/public/설치방법.md`(신규)**: 5단계 설치 안내를 zip 안에 직접 동봉 — Vite가
  `public/` 아래 파일을 빌드 시 자동으로 `dist/` 루트에 복사하는 걸 그대로 활용(코드/워크플로
  변경 없이 파일 하나만 추가). 압축 풀었을 때 폴더 안에서 바로 설치법을 볼 수 있음.
- 검증: 확장 typecheck/lint/vitest(101개) 전부 통과, 로컬 빌드로 `dist/설치방법.md`가 실제로
  나오는지 확인.

### Next

- **Claude가 검증 불가능한 것**: GitHub Actions로 새 zip이 빌드된 뒤, 실제 배포된 zip을 QR로
  받아서 풀었을 때 `설치방법.md`가 폴더 안에 정말 보이는지 확인 필요.

## 2026-08-21 — qa_jobs.py의 중복 MI/AE 과탐지 재검증 제거

review-agent(`bundled_screen_hybrid.py`)가 MI/AE 카테고리의 narrow-context 오탐 재검증을
소스 안에서 직접 정식으로 구현하면서, 여기 `qa_jobs.py`에 있던 같은 목적의 우회 구현
(`_verify_mi_finding`/`_verify_ae_finding`/`_FALSE_POSITIVE_VERIFIERS`, `_run_review_sync`의
ThreadPoolExecutor 재검증 블록)이 review_document() 결과에 대해 독립적으로 한 번 더
같은 판정을 내리는 이중 검증이 되어 있었다. 어느 한쪽만 "없다/모호하다"고 봐도 이슈가
사라지는 구조라 과탐지 방지가 의도보다 훨씬 공격적으로 동작하던 것으로 보여 삭제했다.

- `_run_review_sync()`는 이제 `review_document()` 결과를 바로 `_dedupe_conflicting_categories()`
  (카테고리 우선순위 기반, 이번 작업 범위 밖이라 그대로 유지)에 넘기고 끝낸다.
- 더 이상 쓰지 않는 import 정리(`Callable`, `ThreadPoolExecutor`, `Future`, `isolate_client`,
  `merge_usage`).
- 관련 단위 테스트(`_StubVerifyLLM`, `_verify_mi_finding`/`_verify_ae_finding` 테스트,
  `test_run_review_sync_drops_*_false_positive_*`)도 함께 제거. dedupe 관련 테스트는 그대로 둠.
- 검증: `pytest` 138개 전부 통과, `ruff check` 클린.

### Next

- **Claude가 검증 불가능한 것**: 실제 서비스에서 이중 검증 제거로 MI/AE 이슈 노출 개수가
  실제로 늘어나는지는 재검증(예: 20문서 재검증)으로 확인 필요 — 사용자가 review-agent 쪽
  과탐지 완화(진행 중)와 함께 측정할 예정.

## 2026-08-23 — 팀 규칙 관리 기능 (`feature/eunseong-team-rule-wireframe`)

은성님이 맡은 팀룰 추가 기능을 처음부터 구현했다. 조사 결과 프론트엔드에 "Rule 섹션" 자체가
없었고(백엔드엔 8개 카테고리/41개 규칙 데이터만 존재), 팀 개념도 백엔드 어디에도 없어서
기본 Rule 섹션 구축부터 팀 CRUD까지 함께 진행하기로 사용자와 합의했다(`AskUserQuestion`으로
스코프 확정: 기본 Rule 섹션 포함 / 구조화된 폼 직접 입력(자연어→AI초안 흐름은 제외) / 팀은
"팀 코드 입력" 아래 "팀 만들기"로 팀명+설명을 받아 코드를 생성). 계획은
`EnterPlanMode`로 세운 뒤 승인받고 진행(`/Users/song-eunseong/.claude/plans/wondrous-fluttering-castle.md`).

- **백엔드**: `models/team.py`(`Team`), `models/team_rule.py`(`TeamRule`, `RuleExample`) 신규.
  `storage/store.py`에 팀/팀규칙 dict 추가(기존 in-memory 패턴 그대로, `delete_team_rule`이
  이 스토어의 첫 삭제 메서드). `api/teams.py`(팀 생성/조회, 팀규칙 CRUD, `secrets` 기반 6자리
  코드 생성) + `api/rulebook.py`(`GET /rulebook/categories` — 기존 `qa_jobs.py`의
  `_load_rulebook`/`_korean_label`을 그대로 import해 재사용, 8개 카테고리만 반환) 신규 라우터
  2개, `main.py`에 등록.
- **프론트엔드**: `RuleSection.tsx`(References 아래 신규 — 기본 규칙 카테고리 목록 + "적용된
  규칙: N개" 카운트, 팀 코드 입력/확인, 인라인 "팀 만들기" 폼, 팀 연결 시 "👥 팀명 ⚙" 필),
  `TeamRulesScreen.tsx`(신규 5번째 화면, `.screen`/`.screen-scroll`/`.screen-footer` 셸 재사용),
  `TeamRuleForm.tsx`/`TeamRuleAccordion.tsx`(규칙 사례 여러 개 입력, 수정/삭제),
  `ConfirmDialog.tsx`(이 코드베이스 첫 모달 — `Button`의 `variant="danger"`를 처음 실사용).
  전역 상태(`AppState`)에 `teamCode`/`teamName`/`teamDescription`/`teamRules`/`ruleCategories`
  추가, `appReducer`에 관련 액션 6개 추가. 새 공용 Accordion 컴포넌트는 만들지 않고
  `CategoryTree`/`ReferencesSection`의 기존 토글 패턴을 그대로 복사(사용처 2곳뿐이라 추상화가
  오히려 손해).
- **"적용된 규칙" 카운트 정정**: 계획 초안은 41개 세부 규칙 합산을 가정했으나, 사용자 스펙의
  예시("기본 8개 + 팀 2개 → 10개")를 재확인해 8개 카테고리 + 팀 규칙 수로 정정.
- 검증: 백엔드 `uv run pytest` 149개 전부 통과(`ruff check` 클린), 프론트 `npm run
  typecheck`/`lint`/`test`(vitest 110개) 전부 통과, `npm run build` 프로덕션 빌드 성공. 로컬
  백엔드를 띄워 `curl`로 팀 생성→조회→규칙 생성(최소/전체 필드)→목록→수정→삭제 전체 플로우
  실제 실행 확인(8개 카테고리, 404, CRUD 전부 기대대로 동작).
- **알려진 한계(사용자에게 명시적으로 flag)**: in-memory 저장이라 백엔드 재시작 시 팀/규칙
  소실(기존 documents/qa_jobs와 동일), 인증 없음(팀 코드를 아는 사람은 누구나 수정 가능), 팀
  규칙은 아직 실제 QA 리뷰 파이프라인(`review_document`)에 반영되지 않음(저장/표시만).

### Next

- **Claude가 검증 불가능한 것**: 실제 Chrome에 unpacked 로드해서 사이드패널 UI를 눈으로
  보고 조작하는 것(아코디언 토글, 폼 검증, 확인 다이얼로그 등 시각적 동작) — 은성님이 직접
  `chrome://extensions`에 로드해서 확인 필요.
- 팀 규칙을 실제 LLM 리뷰 파이프라인에 반영하는 작업(`bundled_screen_hybrid.py` 연동)은
  이번 스코프 밖으로 남겨둠 — 다음 단계로 고려.
- 넘버링 하모나이징(은성님 두 번째 담당 기능)은 아직 시작 전, 범위는 혜서/가영님과 확인 필요.

## 2026-08-24 — 팀 규칙 기능 Round 2: 데이터 구조 개편 + 화면 통합 + Agent 연동

Round 1을 실제 Chrome에 로드해 확인한 사용자가 스크린샷 3장 + 상세 명세로 큰 폭의 수정을 요청.
`AskUserQuestion`으로 세 가지 핵심 결정을 받은 뒤 `EnterPlanMode`로 계획을 다시 세우고 승인받아
진행했다(계획: `/Users/song-eunseong/.claude/plans/wondrous-fluttering-castle.md`).

- **데이터 구조 개편**: `TeamRule`에 `rule_name`(신규 필수, 규칙 설명과 분리)과 `enabled`(체크박스,
  기본값 true) 추가. `examples`를 자유 배열에서 `{error1, error2, exception}` 고정 3슬롯 구조로
  변경(`models/team_rule.py`, `api/teams.py`의 `TeamRuleIn`/`TeamRuleResponse`). PATCH는 계속 폼
  전체 교체 방식 유지 — 체크박스 토글도 같은 PATCH로 처리(별도 엔드포인트 안 만듦).
- **화면 구조 통합**: 별도였던 `TeamRulesScreen`을 삭제하고 `RuleSection.tsx` 하나에 기본 규칙
  카드(번호+규칙명+설명, 8개 카테고리 설명은 백엔드에 없는 데이터라 프론트엔드에 하드코딩)와 팀
  규칙 카드(체크박스/토글/✎/🗑/+추가 전부)를 합쳤다. 체크박스는 클릭 즉시 PATCH로 저장(별도 저장
  버튼 없음), 토글은 읽기 전용 상세 보기, ✎만 편집 폼(`TeamRuleForm`)을 연다 — 이 구분은
  `AskUserQuestion`으로 사용자에게 직접 확인받은 UX.
- **Agent 연동(신규 스코프, 이전엔 명시적으로 제외했던 부분)**: `qa_engine/team_rule_adapter.py`
  신규 — 활성화된(`enabled=true`) 팀 규칙을 synthetic `RuleDef`로 변환해 `review_document()`가
  이미 받는 `RuleBook` 파라미터에 merge. 벤더 파일(`bundled_screen_hybrid.py`/`fewshot_bank.py`)은
  한 줄도 안 건드림 — `RuleDef.text`가 `_hybrid_block()`이 파싱 없이 그대로 보간하는 자유 텍스트
  필드라는 점을 이용해, `규칙 설명 + [오류 사례 1]/[수정 사례 1]/[오류 사례 2]/[수정 사례 2]/
  [예외 사례]`를 하나의 문자열로 조합해 그 안에 담았다(저장 구조 자체는 계속 필드별로 분리 유지 —
  합치는 건 Agent에 넘기는 마지막 순간뿐). 구현 전 실제 `RuleDef` 필드 구조와 매핑표를 먼저
  보여달라는 사용자 요청에 따라, 계획 문서에 매핑표 + 라우팅 안전성 근거(코드 인용 5곳)를 먼저
  제시하고 승인받은 뒤 구현. `POST /documents/{id}/qa-jobs`에 선택적 `team_code` 바디 추가,
  `_execute_qa_job`이 있으면 팀 규칙을 merge, 없으면 기존 경로 100% 그대로.
- 검증: 백엔드 `uv run pytest` **158개** 전부 통과(신규: `test_team_rule_adapter.py` 6개,
  `test_api_qa_jobs.py`에 회귀 테스트 2개 추가, `test_api_teams.py` 새 스키마로 재작성),
  `ruff check` 클린. 프론트 `typecheck`/`lint`/`test`(vitest **111개**) 전부 통과, `npm run
  build` 성공. 로컬 백엔드로 curl E2E: 팀 생성 → 새 스키마 규칙 생성(규칙명/고정
  examples/enabled) → PATCH로 enabled=false 토글 → `team_code` 포함/미포함 QA job 생성 둘 다
  200 확인.

### Next

- **Claude가 검증 불가능한 것**: Chrome 실제 로드 후 통합된 Rule 섹션(기본+팀) 시각 확인 —
  은성님 직접 확인 필요. 실제 LLM 응답에 팀 규칙 few-shot 텍스트가 기대한 형태로 도달하는지도
  API 키 있는 환경에서 실제 QA 실행으로만 최종 확인 가능(이번 세션은 `team_rule_adapter.py`
  순수 함수 테스트 + 라우팅 안전성 근거로 대체).
- 넘버링 하모나이징(은성님 두 번째 담당 기능)은 아직 시작 전.

## 2026-08-24 — 팀 규칙 기능 Round 3: 관리 페이지 재분리

Round 2에서 메인 화면 하나로 합쳤던 걸 사용자가 다시 뒤집었다 — "관리(추가/수정/삭제)"와
"적용 선택(체크박스)"의 역할을 분리해 관리는 별도 페이지로, 메인 Rule 화면은 체크박스만 있는
화면으로 되돌렸다. 진입점(관리 페이지로 가는 길)이 명세에 없어 `AskUserQuestion`으로 확인 후
`EnterPlanMode`로 계획을 세우고 진행(백엔드는 이번 라운드에서 전혀 안 건드림 — 순수 프론트엔드
재구성). 계획: `/Users/song-eunseong/.claude/plans/wondrous-fluttering-castle.md`.

- `TeamRulesScreen.tsx` 재생성 — Round 2에서 지웠던 걸 복원하되, 이번엔 팀 코드도 헤더에
  표시(지금까지 팀 생성 후 코드를 확인할 방법이 어디에도 없었던 걸 이번에 채움).
  `TeamRuleAccordion.tsx`에서 체크박스(적용 여부) 관련 로직을 전부 제거 — 이 컴포넌트는 이제
  순수하게 추가/수정/삭제만 담당.
- `RuleSection.tsx`(메인 화면)에서 팀 규칙 추가/수정 폼을 전부 제거하고, 체크박스+규칙명+설명
  한 줄짜리 목록으로 단순화. 체크박스 토글은 `RuleSection`으로 옮겨 즉시 PATCH 저장. 헤더에
  "👥 팀 규칙 · 팀명" 옆 ⚙ 버튼으로 관리 페이지 진입(사용자에게 직접 확인받은 위치). 팀 규칙이
  0개여도 헤더/⚙는 유지하고 목록 자리에 안내 문구만 표시 — 완전히 숨기면 첫 규칙을 추가할 방법이
  없어지는 걸 막기 위한 해석(계획에 명시하고 승인받음). "팀 만들기" 성공 시 관리 페이지로 자동
  이동 추가 — 생성된 코드를 바로 볼 수 있게(사용자가 명시적으로 요구하진 않았으나, 안 그러면 방금
  만든 코드를 볼 방법이 없어 채택).
- 기본 규칙 8개 설명을 전부 한 줄에 들어가도록 문구 자체를 축약(CSS `text-overflow: ellipsis`
  금지 요구 — 실제 문장을 줄임). 팀 규칙 설명은 사용자가 직접 쓴 임의 길이 텍스트라 문구를
  대신 줄여줄 수 없어, 여기에만 예외적으로 CSS 한 줄 말줄임(`.team-rule-row-description`)을 적용.
- 검증: `typecheck`/`lint`/`test`(vitest 111개, 신규 없음 — 로직 이동만이라 리듀서/검증 함수
  변경 없음)/`build` 전부 통과. 백엔드는 안 건드렸으므로 기존 158개 테스트 상태 그대로 유효.

### Next

- **Claude가 검증 불가능한 것**: Chrome에서 관리 페이지 진입(⚙)과 메인 화면 체크박스가 실제로
  분리되어 보이는지, 팀 생성 후 자동 이동으로 코드가 잘 보이는지 — 은성님 직접 확인 필요.

## 2026-08-25 — Fix Suggestions 패널(3a~3d) 디자인 핸드오프 구현

디자인 핸드오프(`design_handoff_fix_suggestions/`)의 3a(목록)~3d(완료 요약) 4개 화면을
사이드패널에 새로 구현하고, 기존 `IssueListScreen` 하나짜리 화면을 대체했다. 범위는
`extension/`만 — 백엔드는 건드리지 않았다. 디자인이 전제하는 "팀 규칙/기본 규칙" 구분,
규칙명/설명/예외상황 필드가 실제 `IssueResponse`에 없어서(백엔드에 그 개념 자체가 없음,
확인 완료) `state/ruleSourceDefaults.ts`에서 `criteria`→규칙명, `reason`→규칙 설명으로
추론하고 소스는 항상 `'builtin'`으로 채운다(타입은 `'team'|'builtin'` 그대로 둬서 나중에
백엔드가 팀 규칙을 내려주면 바로 반영되게만 함) — 예외 상황은 데이터가 없어 행 자체를
렌더링하지 않는다.

- **상태**: `AppState.currentIssueIndex`(인덱스 기반) 제거 → `activeIssueId`(null=목록,
  값 있으면 상세) + `activeLocationIndex`(0|1, 관계형 이슈의 두 위치 순회)로 교체.
  `NAVIGATE_ISSUE` 제거, `CLEAR_ACTIVE_ISSUE`/`CYCLE_ACTIVE_LOCATION`/`UNSTAGE_ISSUE_EDIT`
  (완료 카드 "되돌리기") 신규. `IssueEdit`에 `skipReason` 추가. 신규 순수 함수 모듈
  `state/suggestionProgress.ts`(진행률/다음 미해결 이슈 계산)와 `state/ruleSourceDefaults.ts`.
- **화면**: `SuggestionListScreen`(3a), `SuggestionDetailScreen`(3b+3c를 하나로 합침 — 완료
  스택/남은 목록이 진행 상황에 따라 비었다가 채워질 뿐 같은 화면이라고 판단), `SuggestionSummaryScreen`
  (3d, "팀 규칙 충족 현황"은 실제 데이터가 없어 criteria별 집계로 대체)을 새로 만들고
  `IssueListScreen`/`OverviewPanel`은 삭제. 하위 컴포넌트(`components/suggestions/`):
  `SuggestionCard`/`RuleEvidenceCard`/`SuggestionDirectionCard`(기존 인라인 편집·저장 로직을
  거의 그대로 이식)/`LocationNavigator`/`SourceBadge`/`SkipReasonPrompt`(건너뛰기 사유 UI —
  기존에 이런 UI 자체가 없어서 신규).
- **판단 지점(사람 확인 필요)**: 문서 원문 편집은 계속 사이드패널에서 처리하기로 함(호스트
  페이지에 취소/저장 버튼을 직접 심지 않음 — 스코프를 가장 크게 줄이는 결정). "수정 방향성
  제안" 본문이 실제로는 `issue.suggestion`(교체 문구)이라 디자인 예시 문구보다 딱딱하게
  보일 것. 3a 카드는 팀/기본 규칙으로 그룹핑하지 않고 위치 순서 그대로 나열(실제 `.dc.html`
  레퍼런스가 README 설명과 달리 뒤섞인 순서였음). "다시 검사"는 `main` 화면 이동 정도로만
  처리(원클릭 재스캔은 범위 밖).
- **content script(`issueOverlay.ts`)**: "모든 이슈를 항상 다 하이라이트 + 클릭하면 툴팁"
  방식을 폐기하고, 지금 작업 중인 제안의 위치만 문단 단위로 틴트+마커, 나머지는 흐리게
  (`opacity:.4`) 표시하는 방식으로 전면 교체(`setActiveSuggestion`/`clearActiveSuggestion`).
  텍스트 매칭 로직(`buildLooseTextRegex`, `collectTextSpans`)은 재사용. 저장 로직
  (`applyIssueEdit`)은 그대로 유지. `HistoryExportScreen`은 지속 마크 없이 스크롤만 하는
  `scrollToLocation`을 새로 씀(재작성 안 하고 최소 변경). `useIssueOverlaySync` →
  `useSuggestionOverlaySync`로 재작성(클릭 기반 포커스 리스너 제거 — 상호작용은 전부 패널에서
  시작).
- `eslint.config.js`: `@typescript-eslint/no-unused-vars`에 `_` 접두사 예외 패턴 추가(향후
  확장용으로 남겨둔 매개변수, 예: `getRuleSource(_issue)`, 기존 `_sender` 관례와 통일).
- 검증: 확장 `tsc -b`(빌드), `eslint .`(클린), `vitest run`(95개 전부 통과 — 관련 테스트
  대폭 교체: `issueOverlay.test.ts`를 새 하이라이트 모델에 맞게 다시 쓰고, `appReducer.test.ts`
  갱신, 신규 `suggestionProgress.test.ts` 추가).

### Next

- **Claude가 검증 불가능한 것**: 실제 크롬에 언팩 로드해서 3a→3b/3c→3d 전체 흐름을 눈으로
  확인 필요(문단 틴트/dim, 위치 내비게이터 순회, 완료 스택 되돌리기, 건너뛰기 사유 입력,
  3d에서 QA 통과 배지/기록 화면 링크). 자동 테스트는 DOM 조작 로직 단위로만 커버함.
- 커밋은 보미님이 로컬에서 직접 확인한 뒤 진행하기로 함 — 아직 커밋 안 함.

## 2026-08-25 (이어서) — 문서에서 직접 편집으로 전환

위 3a~3d를 실제로 써본 보미님 피드백으로, "수정은 패널 텍스트 영역에서"(판단 지점 #1)를
뒤집었다 — 이제 **왼쪽 Confluence 문서의 current(실선 틴트) 문단을 직접 클릭해서 바로
고치고**, 옆에 뜨는 취소/저장 버튼으로 저장한다. 저장되면 패널이 자동으로 다음 제안으로
넘어간다. 패널의 기존 텍스트 영역 편집(`SuggestionDirectionCard`)은 지우지 않고 폴백으로
남겼다 — 문서에서 앵커를 못 찾거나(`insert_range`처럼 편집할 원문 자체가 없는 경우 포함)
컨플루언스 탭이 없을 때만 쓴다.

- **`content/issueOverlay.ts`**: `setActiveSuggestion`이 current 문단을
  `contentEditable=true`로 켜고 원문을 `dataset.sunnicOriginalText`에 저장. 옆에는 실제 DOM
  형제가 아니라(표/리스트 구조가 깨질 수 있어서) 예전 AI 제안 툴팁처럼
  `position:fixed`+`getBoundingClientRect` 기반 플로팅 박스(`.sunnic-edit-actions`)로 취소/저장
  버튼을 띄운다(스크롤 애니메이션 중 위치 추적도 예전 툴팁 로직을 재사용). 저장 전 검증도
  패널에 있던 걸 그대로 옮겼다: ① 원래 문제 문구가 아직 남아있는지(로컬, `isIssueLikelyResolved`)
  ② AI 유사도 체크(`api.checkEditSimilarity`, content script도 우리 백엔드는 문제없이 fetch
  가능 — Confluence 인증이 필요한 건 저장 자체뿐). 관련 위치(related) 편집은 비교 기준이 될
  "AI 제안"이 없어 ②를 건너뛴다. 저장 성공 시 패널에 `SUGGESTION_EDIT_SAVED`(fire-and-forget,
  issueId는 안 실음 — content script는 여전히 issueId를 모름)를 보낸다. 장식용으로 넣었던
  깜빡이는 커서 바는 제거(진짜 caret이 생기니 불필요).
- **`content/messages.ts`**: `EditableSuggestionLocation`(criteria/reason/suggestion 포함,
  suggestion이 null이면 유사도 체크 생략) 신규, `SetActiveSuggestionRequest.current`가 이 타입을
  씀. `SuggestionEditSavedMessage` 신규.
- **`hooks/useSuggestionOverlaySync.ts`**: current/related/doneLocations 계산 시 이미 저장된
  위치는 `issueEdits[...]?.editedText`(원본이 아니라 저장된 텍스트) 기준으로 앵커를 다시 찾도록
  수정 — 안 그러면 저장 직후 재순회 시 문서 텍스트가 이미 바뀌어 있어 매칭이 깨진다.
- **`components/screens/SuggestionDetailScreen.tsx`**: `chrome.runtime.onMessage`로
  `SUGGESTION_EDIT_SAVED`를 받아 `STAGE_ISSUE_EDIT`+`api.updateIssue`+다음 제안 이동을 처리하는
  리스너 추가(패널 안에서 저장하는 기존 경로와 같은 일을 하는 두 번째 트리거).
- **`components/suggestions/SuggestionDirectionCard.tsx`**: 기본 표시를 읽기 전용으로 바꾸고
  "왼쪽 문서에서 직접 고치세요" 안내 추가, "오류 수정하기" 링크는 "여기서 직접 수정"(폴백)으로
  라벨만 변경 — 로직은 그대로.
- 테스트: `issueOverlay.test.ts`에 contentEditable 토글/취소 복원/저장(REST+메시지)/유사도 체크
  생략(related) 케이스 추가, 기존 "커서 바" 테스트는 제거. 전체 101개 통과.
- 검증: `tsc -b`/`eslint .`/`vitest run` 전부 통과.

### Next

- **Claude가 검증 불가능한 것**: 실제 문서에서 문단 클릭 → 타이핑 → 저장 → 자동으로 다음
  제안 넘어가는지, 취소 시 원문 복원되는지, related로 전환 시 편집 가능한 문단이 바뀌는지
  눈으로 확인 필요 — 보미님이 직접 확인 중.
- 완료 카드 "되돌리기"는 패널 기록만 지운다 — Confluence 복제본에 저장된 텍스트 자체는
  되돌리지 않는다(기존부터 있던 갭, 이번에 새로 생긴 문제 아님).
- 커밋은 여전히 보미님 확인 후 진행.

## 2026-08-25 (이어서 2) — 클릭으로 편집 진입 + scrollIntoView 제거

실제 컨플루언스 페이지에서 테스트하다 두 가지가 스펙과 다르다는 피드백: ① current 문단이 되는
순간 자동으로 편집 가능해지는 게 아니라 **클릭해야** 편집 모드로 들어가야 하고, 그 클릭 지점에
캐럿이 정확히 놓여야 한다. ② `scrollIntoView`를 쓰고 있었는데, 디자인 핸드오프가 애초에
"컨테이너 스크롤 오프셋 계산 사용, scrollIntoView 금지"라고 명시했었다 — 실제 컨플루언스처럼
중첩 스크롤 컨테이너가 있는 페이지에서 엉뚱한 조상을 스크롤하거나 아예 안 움직이는 것처럼
보일 수 있어서, "‹›가 반응 없어 보이는" 증상의 유력한 원인이었다.

- **`content/issueOverlay.ts`**: current 문단은 이제 틴트만 되고 `contentEditable`은 꺼진
  채로 있다가, **클릭해야** `enterEditMode`가 켜진다 — 클릭 좌표(`clientX/clientY`)로
  `document.caretRangeFromPoint`(크롬 전용 API)를 구해 Selection에 반영해서 캐럿을 정확히
  놓는다(contentEditable을 클릭 "이후"에 켜서 브라우저가 자동으로 캐럿을 안 놔주기 때문에
  수동으로 해야 함). "취소"는 텍스트 원복 + `contentEditable=false` + 박스 닫기까지 완전히
  편집 모드를 해제한다(저장 성공 시도 동일) — 다시 고치려면 또 클릭해야 한다.
- 신규 `findScrollableAncestor`/`scrollElementToCenter`: `scrollIntoView` 대신 실제 스크롤
  가능한 조상(`overflow-y: auto/scroll` + `scrollHeight > clientHeight`)을 직접 찾아 그
  컨테이너의(또는 없으면 `window`의) 스크롤 위치를 계산해서 옮긴다. `setActiveSuggestion`과
  `scrollToLocation` 두 곳 다 교체.
- 테스트: 클릭 전엔 read-only, 클릭 후에만 편집 가능/박스 노출로 전부 갱신, 취소/저장 후
  `contentEditable`이 다시 꺼지는지 확인 추가, 스크롤 스파이를 `scrollIntoView`→`window.scrollTo`
  로 교체. 101개 전부 통과.
- 검증: `tsc -b`/`eslint .`/`vitest run` 전부 통과.

### Next

- **Claude가 검증 불가능한 것**: 실제 컨플루언스 페이지에서 문단 클릭 시 클릭 지점에 캐럿이
  정확히 놓이는지(happy-dom엔 `caretRangeFromPoint`가 없어 자동 테스트로 커버 불가), ‹›로
  위치를 옮길 때 실제로 눈에 보이는 스크롤이 일어나는지 확인 필요 — 보미님이 직접 확인 중.
- 커밋은 여전히 보미님 확인 후 진행.
## 2026-08-27 — PR #113 리뷰 후속 fix 2건

PR #113(팀 규칙 관리 기능) 코드 리뷰에서 나온 "설계 판단 필요" 항목 중 2개를 마무리. 나머지
하나(`tiers.py`의 `TIER_CATEGORIES`에 "TEAM" 추가)는 시도했다가 되돌림 — 아래 참고.

### Done

- **팀 코드 생성 TOCTOU 레이스 제거**: `store.py`에 `save_team_if_new()` 추가 — "코드가
  비어있는지 확인"과 "저장"을 별개의 락 획득 두 번이 아니라 한 번의 락 안에서 원자적으로
  처리. `teams.py`의 `_generate_unique_team_code()` + `store.save_team()` 조합을
  `_create_team_with_unique_code()`(생성-시도-저장을 한 함수로) 하나로 교체.
- **팀 룰 체크박스 토글의 lost-update 제거**: `update_team_rule`(풀-리플레이스 PATCH)은
  그대로 두고, `enabled` 필드만 바꾸는 전용 엔드포인트
  `PATCH /teams/{team_code}/rules/{rule_id}/enabled` 신설. 프론트 `toggleRuleEnabled`가
  이제 이걸 호출 — 더 이상 클라이언트 상태에서 읽은(어쩌면 이미 오래된) rule_name/
  description/exception_text/examples를 다시 보내지 않으므로, 토글이 다른 편집자가 방금
  저장한 필드를 되돌릴 수 없음.
- 신규 테스트 4개: `save_team_if_new`가 같은 코드 두 번째 저장을 거부하는지, 신규 엔드포인트가
  다른 필드는 안 건드리는지, 실제로 "다른 편집자의 동시 편집을 안 되돌리는지"(concurrent-edit
  시나리오 그대로 재현), 잘못된 팀으로는 404인지.
- 164/164 백엔드 테스트 통과(기존 160 + 신규 4), `ruff check` 통과, 프론트 typecheck/lint/
  vitest 111개 그대로 통과(프론트는 `client.ts`/`RuleSection.tsx`만 수정, 로직 이동 수준이라
  신규 테스트 없음).

### Not done — 시도했다가 되돌림

- `tiers.py`의 `TIER_CATEGORIES`에 `"TEAM"`을 추가했더니 `test_tiers.py`의 두 테스트
  (`test_every_assigned_category_exists_in_the_real_rulebook`,
  `test_tier_categories_matches_rulebook_section_2`)가 깨짐 — 이 파일은 벤더링 정책상
  `rulebook_v1.0.md`의 실제 카테고리와 바이트 단위로 일치해야 한다는 걸 검증하는 테스트라,
  "TEAM"을 여기 넣는 건 이 파일의 존재 이유(벤더링 드리프트 감지)를 정면으로 깨는 것.
  프로덕션 경로(`bundled_screen_hybrid.review_document`)는 이 함수를 아예 안 써서 지금은
  위험 없음 — 나중에 `pipeline.review_document` 쪽에 팀 룰을 실제로 merge해서 쓰게 되면, 그
  호출부에서 TEAM 카테고리 룰을 별도로 챙겨 넣는 방식으로 고쳐야 함(이 파일 자체는 손대지
  않고).

## 2026-08-28 — 팀 룰 3단계 자동 분류 (문단형/관계형/부재확인형)

기존 룰(GA/LG/LF/LG-01/TC-02)의 위계 배정이 팀원이 매번 고르는 게 아니라 룰북 작성자가 룰
하나하나마다 미리 정해두는 것처럼, 팀 룰도 작성자가 "이건 관계형이다" 같은 걸 고르게 하는 대신
저장 시점에 자동 분류하도록 만듦. 유사도/임베딩 매칭이 아니라 LLM 분류 호출을 쓴 이유: "관계형
이냐"는 룰의 토픽이 아니라 구조(두 위치를 비교해야 하는가)의 문제라, 기존 룰 예시와의 표면적
유사도로는 잘 안 맞음(예: "환불 정책 두 문서 위치가 일치해야 한다"는 GA의 기존 예시들과 토픽은
안 겹치지만 구조는 명백히 relational).

### Done

- **planqa-agent(모델 레포)에 먼저 확장 포인트 추가** — `ABSENCE_CHECK_RULE_IDS`가
  `{"LG-01", "TC-02"}` 딱 2개 rule_id만 인식하는 폐쇄 집합이라, 동적으로 생성되는 팀 룰
  rule_id는 절대 인식 못 함. `_paragraph_and_document_rules()`/`review_document()`에
  `extra_absence_check_rule_ids: frozenset[str] = frozenset()` 키워드 인자 추가(기본값이라
  기존 호출부 전부 영향 없음). PR sunic5-planqa/planqa-agent#44로 올려서 머지 후 재벤더링.
  관계형은 반대로 기존 `category in {LG,LF,GA}` 판정을 그대로 재사용 가능해서(팀 룰
  category를 내부적으로 "GA"로 세팅) 벤더링된 파일을 안 건드림 — 모델이 실제로 보는 건
  `category_label`(팀이 지은 이름)뿐이고 raw category 코드는 프롬프트에 안 나가서 안전.
- `TeamRule`에 `scope: "paragraph" | "relational" | "absence_check" = "paragraph"` 추가 —
  팀 관리자가 고르는 필드 아님, 폼에도 선택지 없음.
- 신규 `team_rule_classifier.classify_scope()` — rule_name/description/exception_text를
  보고 구조 기준으로 분류하는 LLM 호출 1번(룰 생성/수정 시점에만, QA 실행마다가 아님).
  분류 실패(모호함/LLM 에러 전부)는 안전하게 "paragraph"로 폴백.
- `team_rule_adapter.py`: `team_rule_to_ruledef()`가 scope="relational"이면
  category="GA", 그 외엔 기존과 동일 category="TEAM". `merge_team_rules()`는 이제
  `(RuleBook, absence_check 인 rule_id 집합)` 튜플을 반환 — absence_check는 카테고리로
  재사용할 자리가 없어서 rule_id로 직접 라우팅해야 함.
- `qa_jobs.py`: `merge_team_rules()`의 두 번째 반환값을
  `review_document(extra_absence_check_rule_ids=...)`로 그대로 전달.
- `api/teams.py`: `create_team_rule`/`update_team_rule`이 저장 전 분류 호출(GeminiClient,
  `asyncio.to_thread`로 이벤트 루프 안 막음, 클라이언트 생성 자체가 실패해도 paragraph로
  폴백). `set_team_rule_enabled`는 재분류 안 함(내용이 안 바뀌니까) — scope 그대로 유지.
  `TeamRuleResponse`에 `scope` 노출(투명성 목적, 클라이언트가 보낼 순 없음).
- 프론트: `TeamRuleResponse` 타입에 `scope` 추가.
- 신규 테스트: `team_rule_classifier` 5개(정상/잘못된 값/비-dict 응답/LLM 에러/프롬프트 내용
  확인), `team_rule_adapter` 3개(relational→GA, absence_check→TEAM 유지,
  merge_team_rules가 absence_check rule_id 집합을 정확히 반환), `api/teams` 4개(기본값
  paragraph, 분류 결과 저장, update 시 재분류, enabled 토글은 재분류 안 함).
- **실수로 실제 Gemini API를 호출할 뻔한 것을 잡음**: 이 저장소 `.env`에 진짜
  `GEMINI_API_KEYS`가 있어서, 스텁 없이 그냥 뒀으면 팀 룰 테스트 전체가 매번 실제 네트워크
  호출을 했을 것(느리고, flaky하고, 실제 쿼터 소모). `test_api_teams.py`에
  `autouse=True` 픽스처로 `GeminiClient`를 가짜로 교체해서 해결 — 스텁 적용 전/후 같은
  파일 테스트 실행 시간이 17초대 → 2초대로 확인됨.
- 백엔드 176/176 테스트 통과(기존 167 + 신규 9), `ruff check` 통과. 프론트
  typecheck/lint/vitest 111개 통과.

### Next

- planqa-agent#44 머지·재벤더링 완료됨 — 이 기능은 그 위에서 바로 동작.
- 팀 룰 작성 폼에 분류 결과(scope)를 보여줄지는 아직 미정 — 지금은 API 응답에만 노출.

## 2026-08-28 (계속) — 타문서 정합성(XDC) 리뷰 파이프라인 연동

승현이 독립적으로 XDC 기능을 구현(sunic5-planqa/planqa#115)했는데, 팀 룰 통합 코드를
실수로 되돌리는 문제가 있어 그 PR 자체는 안 씀 — 대신 룰 카탈로그(XDC-01~04)만 이식하고,
실제 구현은 planqa-agent의 review-agent 쪽(더 많은 매칭 신호, 벤더링 정책 준수, 139개
테스트로 검증됨)을 재벤더링해서 연결했다. 상세 배경은 planqa-agent#43/#44/#45 참고.

### Done

- **재벤더링**: `structures/xdc.py`(신규), `structures/bundled_screen_hybrid.py`(참고문서
  있을 때만 활성화되는 decision_records 추출 + XDC 전용 confirm 트랙),
  `planqa_schemas/schema.py`(Issue에 reference_document/reference_section/reference_quote/
  difference_type 4필드), `planqa_schemas/rulebook.py`(룰 ID 정규식 `{2}`→`{2,3}`,
  XDC 같은 3자 카테고리 지원), `dedupe.py`(`_same_reference` 가드) — planqa-agent
  services/review-agent에서 그대로 복사 + import 네임스페이스만 재작성.
- `data/xdc/xdc_rulebook_v1.0.md`(XDC-01~04), `data/xdc/aliases.json` 데이터 파일 추가.
- `api/qa_jobs.py` 연동:
  - `CreateQAJobRequest.reference_document_ids: list[str] = []` 추가(`team_code`는 유지).
  - `_execute_qa_job`이 그 id들로 `store.get_document()`를 조회해 `(id, raw_text)` 쌍으로 변환.
  - **중요한 설계 결정**: XDC 룰북은 `review_document()`의 팀 룰과 같은 `rulebook` 인자에
    합치지 않고 별도 `xdc_rulebook=` 키워드 인자로만 넘긴다 — 합치면
    `_paragraph_and_document_rules()`가 XDC-01~04를 일반 문단형 내부 룰로 오인해서
    참고문서 없이 현재 문서 혼자 스크리닝/컨펌해버리는 오류가 생김(승현 버전에는 없던 문제,
    설계 단계에서 미리 확인).
  - `_to_issue_record`/`_dedupe_conflicting_categories` 전용으로 XDC를 합친 조회용
    rulebook(`_rulebook_for_lookup`)을 별도로 만들어 사용 — criteria/frame_type/우선순위
    판정에 필요.
- **승현 버전에서 발견한 버그 2개를 여기서는 처음부터 피함**:
  1. XDC 이슈가 dedup에서 조용히 사라지는 문제(`_CATEGORY_PRIORITY`에 XDC 미등록 시
     TEAM처럼 최하위 취급) → `_CATEGORY_PRIORITY`에 `"XDC": 0`(GA와 동급) 추가로 방지.
  2. XDC 이슈가 RANGE 프레임으로 안 그려지는 문제(`rulebook.rule(rule_id)`가 None이라
     `_frame_type`이 항상 OBJECT로 폴백) → `_rulebook_for_lookup`으로 XDC를 조회 가능하게
     만들고, `_RANGE_CATEGORIES`에 `"XDC"` 추가로 해결.
  - 추가로, XDC의 두 번째 위치(참고문서 쪽)는 `reference_document/reference_section/
    reference_quote`라는 별도 필드로 오는데, 프론트까지 새 스키마를 뚫는 대신 관계형
    (LG/LF/GA)이 이미 쓰는 `related_location`/`related_original_text` 표시 경로를
    재사용(`[문서ID] 위치` 라벨로 합성) — 프론트 코드 변경 없이 기존 RANGE 프레임
    렌더링을 그대로 씀.
- 신규 테스트 5개: `_frame_type` XDC 케이스 2개, dedup 우선순위(XDC가 안 사라지는지),
  `_to_issue_record`의 reference→related_location 매핑, API 전체 배선(참고문서 텍스트가
  실제로 `review_document()`까지 도달하는지 + 응답에 관계형 필드가 매핑되는지) e2e 1개.
- 백엔드 169/169 테스트 통과(기존 164 + 신규 5), `ruff check` 통과.

### Next

- 프론트: 참고문서를 고르는 UI가 아직 없음 — `client.ts`의 `createQAJob`도 아직
  `reference_document_ids`를 안 받음. 이건 별도 UX 설계가 필요한 신규 기능이라 이번엔
  백엔드 계약만 만들어두고 UI는 안 건드림.
- 승현님께 PR #115 대신 이 PR을 쓴다고 설명하고 #115는 닫아달라고 요청 필요.

## 2026-08-29 (계속) — PR #117 코드 리뷰 후속 수정 3건

### Done

- **참고문서 캐시 미전달**: `review_document(reference_cache=...)`를 안 넘겨서 QA job마다
  같은 참고문서를 매번 재인덱싱하고 있었음 — 모듈 레벨 `_reference_cache` 딕셔너리(프로세스
  생애 동안 유지, `_rulebook`/`_xdc_rulebook` 캐시와 같은 패턴)를 추가해서 전달.
- **참고문서 여러 개일 때 dedup에서 하나가 사라지는 문제**: `_dedupe_conflicting_categories`의
  키가 `(location, original_text)`뿐이라 XDC-01이 참고문서 A/B 둘 다와 충돌해도 하나만
  남았음 — 키에 `reference_document`를 추가해서 해결(XDC 아닌 이슈는 항상 None이라 기존
  동작 안 바뀜). 부수적으로 XDC/GA가 `_CATEGORY_PRIORITY`에서 우선순위 0으로 동률이던
  문제도 이 키 확장으로 자연히 해소(둘은 reference_document 값이 달라 이제 애초에 같은
  키로 안 묶임).
- planqa-agent 쪽 버그(XDC confirm 실패 시 정상 이슈까지 날아가는 문제,
  sunic5-planqa/planqa-agent#46)도 재벤더링해서 반영.
- 신규 테스트 2개: dedup이 참고문서 다른 XDC 이슈 둘 다 보존하는지, `reference_cache`가
  실제로 (매 job마다 새로 안 만들고) 같은 객체로 전달되는지.
- 리뷰에서 나온 나머지 2건(docstring 스타일, `extra_absence_check_rule_ids` 죽은 코드
  지적)은 각각 기존 코드베이스 관례와 일치/무관한 다른 기능 소관이라 스킵.
- 백엔드 170/170 테스트 통과, `ruff check` 통과.

## 2026-08-29 (계속) — XDC 첫 라이브 평가 + XDC-03 예외 문구 재벤더링

planqa-agent에서 손으로 만든 골든 케이스 5개(XDC-01~04 각 1개 + 오탐 방지 예외 1개)를
실제 Gemini+Sonnet으로 처음 라이브 평가 — XDC-03(재고 자동 환불 vs 참고문서 수동 상담
처리)이 예외 조건 문구가 너무 넓어서 미탐지됨(4개 중 3개 재현율). 예외 조건을 좁혀서
재검증한 결과 4/4 재현율, 오탐 0건으로 개선(상세: sunic5-planqa/planqa-agent#47).

### Done

- 수정된 `xdc_rulebook_v1.0.md` 재벤더링(파일 하나만 교체, 코드 변경 없음).
- 백엔드 170/170 테스트 통과(룰 텍스트만 바뀐 데이터 파일이라 회귀 없음), `ruff check` 통과.

### 한계

- n=5짜리 손으로 만든 케이스라 방향성 확인 수준 — 정식 recall/precision 벤치마크는 아님.

## 2026-08-30 (계속) — documents/teams/team_rules에 Postgres 백엔드 추가 (Render 재배포 생존)

`storage/store.py`가 지금까지 `documents`만 로컬 SQLite 파일로 저장하고 `teams`/`team_rules`는
순수 메모리(dict)였다는 걸 발견 — Render 무료 플랜은 파일시스템이 휘발성이라, SQLite 파일도
재배포마다 날아가고 팀 코드/팀 룰은 그보다 더 자주(백엔드 재시작마다) 날아가는 상태였음.

### Done

- `_SqliteBackend`(기존 로직 그대로 옮김) + 신규 `_PostgresBackend`(asyncpg) 두 백엔드를
  `Store`가 `DATABASE_URL` 유무로 선택 — 설정 안 하면 기존과 100% 동일하게 로컬 SQLite 파일로
  동작(로컬 개발/테스트는 DB 가입 없이 그대로 zero-config).
- `teams`/`team_rules`도 SQLite/Postgres 양쪽에 테이블 추가 — `save_team_if_new`의 원자성은
  이제 앱 레벨 `asyncio.Lock` 대신 DB의 PK 제약(sqlite `IntegrityError` / Postgres
  `ON CONFLICT DO NOTHING`)이 보장.
- Postgres 커넥션 풀은 `Store.__init__`이 아니라 첫 실제 호출 시 지연 생성(`_ensure_pool`,
  `asyncio.Lock`으로 동시 첫 호출 가드) — `Store()`가 이벤트 루프 없는 모듈 임포트 시점에
  동기적으로 생성되는 기존 구조를 안 건드리기 위함.
- `config.py`에 `database_url: str = ""` 추가, `.env.example`/`render.yaml`에 `DATABASE_URL`
  플레이스홀더 추가(`sync: false`, 실제 값은 Render 대시보드에서 직접 입력).
- **테스트 격리 버그를 먼저 잡음**: `test_api_teams.py`의 `test_save_team_if_new_rejects_a_taken_code`가
  고정 코드("RACE01")를 쓰는데, teams가 이제 SQLite 파일로 영속되면 pytest를 두 번째 돌릴 때부터
  그 코드가 이미 존재해서 깨질 뻔함 — `backend/tests/conftest.py` 신규, 세션 시작 시 `store`
  싱글턴의 `_backend`를 `tmp_path_factory`의 임시 파일로 교체(이름 재바인딩이 아니라 기존
  객체를 mutate — 이미 `from ... import store`로 참조를 든 다른 모듈들도 그대로 반영됨).
  연속 두 번 실행해서 재현 확인.
- 신규 테스트 2개(`Store(dsn=None)`→SQLite, `Store(dsn="postgresql://...")`→Postgres 백엔드
  선택, 후자는 실제 연결 없이 지연 생성만 확인). 백엔드 184/184 통과, `ruff check` 통과.

### Next

- 기존 `backend/data/sunnic.db`에 있던 documents(있다면)는 마이그레이션 안 함 — 로컬 세션
  데이터라 새 DB로 넘길 가치가 낮다고 판단.

## 2026-08-31 — Neon 연결 + `_PostgresBackend` 라이브 검증

`neondatabase/agent-skills`(neon, neon-postgres)를 설치하고 Neon CLI로 사용자 계정(org 가영,
프로젝트 `flat-thunder-85545282`)에 연결 — 지난 세션에서 미검증으로 남겨뒀던
`_PostgresBackend`를 실제 Neon Postgres에 물려서 확인했다.

### Done

- Node 20(시스템 기본)이 `skills` CLI 요구 버전(≥22.20)보다 낮아서 `brew install node@22`로
  별도 설치(keg-only라 기본 `node`는 안 건드림) 후 그 PATH로 skills/neon CLI 실행.
- `neon auth`로 브라우저 OAuth 인증(사용자가 직접 로그인) → `neon connection-string --pooled`로
  `flat-thunder-85545282` 프로젝트의 pooled 연결 문자열 확보 — 웹앱 정상 트래픽용이라 pooled
  선택(`neon-postgres` 스킬의 pooled vs direct 가이드대로, 마이그레이션/직접 세션이 필요한
  작업이 아님).
- 로컬 `backend/.env`에 `DATABASE_URL` 추가(Render 대시보드는 사용자가 직접 설정 필요 —
  API/CLI로 Render 쪽 접근 권한 없음).
- **라이브 검증**: `Store(dsn=settings.database_url)`로 실제 `_PostgresBackend` 생성 →
  `save_team_if_new`/`get_team`/중복 방지까지 실제 Neon에 테이블 생성부터 전부 확인 후 테스트
  행 정리. `pytest`는 `conftest.py`의 임시 SQLite 격리 덕분에 `.env`에 진짜
  `DATABASE_URL`이 있어도 실제 Neon을 안 건드리고 184/184 그대로 통과 확인.

### Next

- Render 대시보드에서 `DATABASE_URL` 직접 설정 필요(사용자).

## 2026-08-31 (계속) — MI/AE 과탐지 검증 + fix_direction 쉬운 문구 재벤더링

혜서 담당 작업(review-agent 쪽 2개, planqa-agent#49)이 `services/review-agent`에는 반영됐지만
여긴(벤더링 사본) 아직이라 재벤더링. `_SCREEN_HYBRID_SYSTEM`/`_CONFIRM_HYBRID_SYSTEM`의
2026-08-30 TEMP 한국어 강제 지시(gpt-5-mini 대응용, PR #119)는 벤더링 정책상 로컬 패치라
그대로 유지 — 이번 재벤더링과 무관.

### Done

- `_MI_VERIFY_SYSTEM`/`_AE_VERIFY_SYSTEM`/`_verify_mi_finding`/`_verify_ae_finding`/
  `_FALSE_POSITIVE_VERIFIERS`/`_verify_false_positives`를 XDC 섹션 앞에 추가,
  `review_document()` 끝 dedupe 직후에 연결. `_CONFIRM_HYBRID_SYSTEM`의 `fix_direction`
  지시에 "전문 용어 없이 비전문가가 바로 실행할 수 있는 문장으로" 추가.
- 신규 테스트 9개 포팅(services/review-agent와 동일, ruff `C408` 지적으로 `dict(...)` →
  리터럴만 차이).
- 백엔드 193/193 통과(기존 184 + 신규 9), `ruff check` 통과.

### Next

- 실제 서비스에서 MI/AE 노출 개수가 회복되는지는 아직 미측정(planqa-agent 쪽도 동일하게
  미측정 상태로 남아있음).
