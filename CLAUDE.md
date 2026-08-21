# 써니C (SunniC)

LLM 기반 서비스 기획서 QA 검증 도구. `backend/`(FastAPI)와 `extension/`(Confluence 사이드패널 크롬 익스텐션)을 한 저장소에서 관리한다.

## 처음 기여하는 사람에게

대화 시작할 때 상대가 "나는 보미야"/"나는 승현이야"/"나는 은성이야" 처럼 자기 이름을
말하면, `docs/onboarding/<이름>.md`가 있는지 확인하고 있으면 그 내용부터 안내해라 —
그 사람이 맡은 기능, 작업할 폴더, 브랜치 전략을 그 문서 기준으로 설명하고 이 CLAUDE.md의
일반 규칙(코드 스타일/커밋 형식)은 보충 설명으로만 써라. 전체 협업 규칙은
`CONTRIBUTING.md`에 있다.

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
