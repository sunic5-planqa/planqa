#!/bin/bash
# main/dev로의 직접 push를 로컬에서 미리 막는다.
# 실제 방어선은 GitHub 브랜치 보호 규칙이고, 이건 그 실패를 조기에 알려주는 보조 장치일 뿐이다.
input=$(cat)
cmd=$(echo "$input" | jq -r '.tool_input.command // empty')

echo "$cmd" | grep -qE '(^|[;&|]|\bgit )push\b' || exit 0

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
if [[ "$branch" == "main" || "$branch" == "dev" ]]; then
  echo "{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"deny\",\"permissionDecisionReason\":\"지금 로컬 브랜치가 '$branch'입니다. main/dev에는 직접 push 금지 — feature/<이름>-<주제> 브랜치를 만들어 dev로 PR을 여세요 (CONTRIBUTING.md 참고).\"}}"
  exit 0
fi

if echo "$cmd" | grep -qiE '(^|[[:space:]])(origin[[:space:]]+)?(head:)?(main|dev)([[:space:]:]|$)'; then
  echo "{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"deny\",\"permissionDecisionReason\":\"main/dev로의 직접 push는 금지입니다. feature/<이름>-<주제> 브랜치를 만들어 dev로 PR을 여세요 (CONTRIBUTING.md 참고).\"}}"
  exit 0
fi

exit 0
