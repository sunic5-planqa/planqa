# 배포 가이드 (Render 무료 티어)

배경/왜 이 방식인지는 `docs/adr/0002-deploy-backend-to-render-free-tier.md` 참고.

## 1. 백엔드 배포 (Render)

1. https://render.com 에서 GitHub 계정으로 가입/로그인 (신용카드 필요 없음)
2. 대시보드에서 **New +** → **Blueprint** 선택
3. 이 저장소(`sunic5-planqa/planqa`)를 연결 — 루트의 `render.yaml`을 Render가 자동으로 읽어서
   서비스 설정을 알아서 채움(빌드 명령어, 시작 명령어 등 이미 다 지정돼 있음)
4. 배포 진행 중에 **환경 변수 입력을 요구**하는 화면이 뜸 — 여기서 아래 값 채우기:
   - `ANTHROPIC_API_KEY`: 우리 `.env`에 있는 실제 키 값 그대로
   - `ALLOWED_ORIGINS`: 일단 비워두거나 아무 값이나 넣고 넘어가기 — **3단계에서 실제 값을 알게 된
     뒤 다시 채워야 함** (Chrome 확장 ID는 확장을 실제로 로드해봐야 알 수 있어서 순서가 이렇게 됨)
5. 배포가 끝나면 서비스 상세 페이지 상단에 `https://sunnic-backend-XXXX.onrender.com` 같은 주소가
   나옴 — 이 주소를 복사해두기 (2단계에서 씀)
6. `https://<그 주소>/healthz`로 접속했을 때 `{"status":"ok"}`가 뜨면 정상 배포된 것

## 2. 확장 프로그램 빌드 (그 주소로)

```bash
cd extension
VITE_API_BASE_URL=https://<1단계에서 복사한 주소> npm run build
```

`dist/` 폴더가 그 주소를 기본 서버로 쓰도록 빌드됨.

## 3. 확장 ID 확인 후 CORS 허용 (한 번만)

1. `chrome://extensions` → "압축해제된 확장 프로그램 로드" → 방금 만든 `extension/dist` 폴더 선택
2. 카드에 나오는 **ID**(32자리 문자열) 복사
3. Render 대시보드 → 이 서비스 → **Environment** 탭 → `ALLOWED_ORIGINS` 값을
   `chrome-extension://<복사한 ID>`로 채우고 저장 (자동으로 재배포됨)

> 이 확장 ID는 `extension/dev-key.public.txt`로 고정돼 있어서, **같은 소스로 빌드하는 한 누가
> 빌드하든 항상 같은 ID**가 나온다 — 한 번만 설정하면 계속 유효함.

## 4. 나머지 4명에게 배포

- `extension/dist` 폴더를 압축(zip)해서 전달
- 각자 압축 풀고 `chrome://extensions` → "압축해제된 확장 프로그램 로드"로 그 폴더 선택
- Python/서버 설치 전혀 필요 없음 — 다들 같은 Render 서버를 같이 씀

## 알아둘 점

- **무료 티어라 15분 정도 안 쓰면 서버가 잠든다** — 그 뒤 첫 요청은 서버가 깨어나는 데 몇십 초
  더 걸릴 수 있음(QA 검토 자체도 원래 1분 정도 걸리니 크게 체감 안 될 수 있음).
- Render 서비스 주소가 바뀌면(플랜 변경 등) 2단계부터 다시 해야 함 — 확장을 다시 빌드해서 재배포.
- 다들 **같은 백엔드**를 공유하므로, Anthropic API 사용량/비용도 공유됨 — 여러 명이 동시에 QA
  검토를 돌리면 그만큼 API 호출이 늘어남.
