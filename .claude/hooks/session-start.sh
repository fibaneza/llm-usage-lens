#!/bin/bash
# SessionStart hook for Claude Code on the web.
# Installs project dependencies so tests, type-checks, and linters work in
# remote sessions. Runs synchronously: the session waits until deps are ready,
# which avoids races where the agent runs a gate before installs finish.
set -euo pipefail

# Only run in the remote (web) environment. Local devcontainer setup is handled
# by .devcontainer/post-create.sh — see .devcontainer/README.md.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"

# pnpm is the package manager (CLAUDE.md). corepack ships with Node 22 LTS.
corepack enable >/dev/null 2>&1 || true

# Root pnpm workspace (apps/* + packages/*) lands in Phase 1. Until then there
# is no root package.json, so this block is a no-op — it activates automatically
# once Phase 1 adds the manifest. Use install (not ci-style) so the cached
# container layer is reused on resume.
if [ -f "$ROOT/package.json" ]; then
  echo "session-start: installing root workspace dependencies"
  (cd "$ROOT" && pnpm install)
fi

# Standalone Bedrock simulator harness — its own package, deliberately outside
# the dashboard pnpm workspace (CLAUDE.md, "Out-of-scope tooling"). Installed so
# its vitest suite and tsc type-check are runnable in web sessions.
if [ -f "$ROOT/tools/bedrock-simulator/package.json" ]; then
  echo "session-start: installing bedrock-simulator dependencies"
  (cd "$ROOT/tools/bedrock-simulator" && pnpm install)
fi

echo "session-start: dependencies ready"
