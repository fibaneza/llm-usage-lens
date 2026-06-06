#!/usr/bin/env sh
# PostToolUse(Write|Edit): format the touched file with Prettier for fast
# format-on-edit feedback, ahead of the lint-staged pre-commit pass.
# Source: docs/specs/2026-05-15-implementation-phases.md §Phase 1 (Claude Code
# hooks). Never blocks — formatting is best-effort.
input=$(cat)
file=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')
[ -z "$file" ] && exit 0
[ -f "$file" ] || exit 0

case "$file" in
  *.ts | *.tsx | *.js | *.jsx | *.mjs | *.cjs | *.json | *.css | *.md) ;;
  *) exit 0 ;;
esac

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
pnpm exec prettier --write "$file" >/dev/null 2>&1
exit 0
