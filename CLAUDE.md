# 써니C (SunniC)

LLM 기반 서비스 기획서 QA 검증 도구. `backend/`(FastAPI)와 `extension/`(Confluence 사이드패널 크롬 익스텐션)을 한 저장소에서 관리한다.

## 처음 기여하는 사람에게

대화 시작할 때 상대가 "나는 보미야"/"나는 승현이야"/"나는 은성이야" 처럼 자기 이름을
말하면, `docs/onboarding/<이름>.md`가 있는지 확인해라 — 있으면 그 사람이 맡은 기능만
그 파일에서 가져와 안내하고, 설치/실행 방법과 브랜치·커밋·PR 흐름은 그 파일에 없으니
`README.md`(설치/실행)와 `CONTRIBUTING.md`(브랜치·PR 흐름)를 그때그때 읽어서 설명해라 —
이 두 문서가 원본이니 `docs/onboarding/`에 미리 베껴두지 않는다.

# Workflow

## Collaboration

### Code Styles

- Use modern language features
- Limit lines to 120 characters maximum.
- Prefer pure functions where possible.
- NEVER write docstrings, function descriptions, or line-by-line comments.
- Only add inline comments to explain the *why* of non-obvious business logic, not the *what* of the code.

### Commit Template

`<category>: <short_summary>`

- categories: 'feat', 'fix', 'refactor', 'docs', 'test', 'chore', 'perf'
- example: `feat: add validation to prevent crash on special chars`
- **70 chars max**, imperative, English only
- NO body lines, NO co-authoring yourself.

## Progress Log

- Keep a running log of work in `docs/progress.md`.
- One dated section per work session (`## YYYY-MM-DD — short title`), newest at the bottom.
- Each entry: what was done, key results (tables/numbers where relevant), and a `### Next` list of
  what's left. This is the backup of "what Claude did" across sessions — write it so a fresh session
  (or teammate) can pick up context without re-reading the whole diff history.

## Architectural Decision Record (ADR)

- Save all ADRs in the `docs/adr/` folder.
- Use 4-digit numbers so the ADRs stay in order: `docs/adr/NNNN-decision-title.md`

### ADR Template

- Title: A short name (e.g., Use PostgreSQL for Database)
- Status: Draft, Accepted, Rejected, or Deprecated
- Date: Date & time
- Context: What is the problem and what rules limit your choices?
- Options: What other choices did you think about?
- Decision: What is the final choice and why?
- Consequences: The pros, cons, and trade-offs of this choice.
