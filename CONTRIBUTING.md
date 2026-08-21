# 기여 가이드 (처음 기여하는 사람용)

이 문서는 git/코드가 처음인 팀원을 위한 최소 안내입니다. 코드 스타일/커밋 메시지 형식 같은
자세한 규칙은 `CLAUDE.md`를 참고하세요.

## 처음 한 번만

```bash
git clone https://github.com/sunic5-planqa/planqa.git
cd planqa
```

`backend/.env.example` 또는 `extension/` 쪽 설정이 필요하면 예시 파일을 복사해서 만드세요.
API 키 같은 값은 절대 직접 만들지 말고 **혜서(@pforu) 또는 가영(@kayo2e)한테 받으세요.**

## 브랜치 만들기

**항상 `dev`에서 새 브랜치를 땁니다. `main`은 절대 직접 건드리지 않습니다.**

```bash
git checkout dev
git pull origin dev
git checkout -b feature/<이름>-<작업내용>   # 예: feature/bomi-edit-button
```

## 작업 → 커밋 → PR

1. 코드 작성 (스타일은 `CLAUDE.md` 참고: docstring/줄별 주석 금지, 120자 제한)
2. 커밋: `<category>: <짧은 설명>` 형식, 영어, 70자 이내
   - 예: `feat: add scroll-to-error on click`
3. push 후 `dev`를 대상으로 PR 생성 — 위 PR 템플릿의 체크리스트를 채우세요
4. **직접 push가 안 되니, PR을 하고 혜서/가영님께 merge 요청을 드리세요**

## 가장 흔한 실수

- **`.env` 파일을 커밋에 포함시키는 것** — API 키가 그대로 GitHub에 공개됩니다. `.gitignore`에
  이미 등록돼 있는지 confirm하고, 혹시 실수로 올라갔다면 바로 알려주세요 (지우는 것과 별개로
  키 자체를 재발급해야 할 수 있습니다).
- `main`에 직접 push하려는 것 — 브랜치 보호로 막혀 있지만, 애초에 `dev`에서 시작하는 습관을
  들이는 게 안전합니다.
- 리뷰 없이 자기 PR을 스스로 merge하려는 것 — 어차피 직접 push가 안 되니, PR을 하고
  혜서/가영님께 merge 요청을 드리세요.

막히는 부분 있으면 코드보다 먼저 혜서/가영한테 물어보세요 — 처음이라 막히는 건 당연합니다.
