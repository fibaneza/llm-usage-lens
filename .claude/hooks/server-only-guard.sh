#!/usr/bin/env sh
# PreToolUse(Write|Edit) on apps/dashboard/**/*.tsx: enforce the Rule 10
# server-only boundary — block an @aws-sdk/* or lib/data import from landing in
# a "use client" module. This is the one check the git hooks and the
# settings.json deny list cannot do at write time.
# Source: docs/specs/2026-05-15-implementation-phases.md §Phase 1;
# .claude/rules/10-server-only-boundary.md.
input=$(cat)
file=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')

case "$file" in
  */apps/dashboard/*.tsx) ;;
  *) exit 0 ;;
esac

# Content being written: Write provides .content, Edit provides .new_string.
content=$(printf '%s' "$input" | jq -r '.tool_input.content // .tool_input.new_string // empty')
[ -z "$content" ] && exit 0

# Only enforce inside a Client Component.
printf '%s' "$content" | grep -Eq "['\"]use client['\"]" || exit 0

if printf '%s' "$content" | grep -Eq "from ['\"](@aws-sdk/|@/lib/data|[^'\"]*lib/data)"; then
  echo "Rule 10 violation: a \"use client\" component must not import @aws-sdk/* or lib/data/** (the server-only data boundary). Move the data access into a Server Component or a Route Handler. See .claude/rules/10-server-only-boundary.md" >&2
  exit 2
fi

exit 0
