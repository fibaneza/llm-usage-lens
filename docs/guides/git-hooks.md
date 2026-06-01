# Git hooks guide

Source of truth for the project's local git hook strategy. Covers the current
simulator pre-push hook and the Phase 1 Husky setup that supersedes it.

## Overview

The project uses two hook mechanisms at different points in its lifecycle:

| Phase | Mechanism | Scope |
|---|---|---|
| Now (pre-Phase 1) | Shell script in `tools/bedrock-simulator/.hooks/` | Simulator only |
| Phase 1+ | Husky (`core.hooksPath=.husky`) | Entire repo |

When Phase 1 wires up Husky, it sets `core.hooksPath=.husky/`. This bypasses
`.git/hooks/` entirely — the simulator's installed hook becomes inactive and
should be removed with `pnpm hooks:uninstall`.

---

## Current state — simulator pre-push hook

**File:** `tools/bedrock-simulator/.hooks/pre-push`

Triggers on `git push` when any commit in the push touches `tools/bedrock-simulator/`.
A push that only touches other paths exits immediately without running anything.

**What it runs:**

1. `pnpm typecheck` — `tsc --noEmit`; fails fast before any I/O.
2. `pnpm test` — Vitest unit suite; mocked, no network, runs in seconds.
3. Dependency health — **warn-only**, never blocks the push: `pnpm outdated`
   (behind latest), `pnpm audit` (known vulnerabilities), and
   `pnpm dedupe --check` (duplicate versions). Enforcement lives in CI — the
   `bedrock-simulator build` gate **fails** on any vulnerability, and
   `bedrock-simulator deps` is an on-demand full report (see
   [`.github/README.md`](../../.github/README.md)). These three steps reach the
   network; offline they print a warning and the push still proceeds.
4. Secret scan — gitleaks preferred; grep patterns as fallback.

**Install / remove** (run from `tools/bedrock-simulator/`):

```bash
pnpm hooks:install    # copies .hooks/pre-push → .git/hooks/pre-push
pnpm hooks:uninstall  # removes .git/hooks/pre-push
```

**Why pre-push, not pre-commit:** The full test suite on every commit adds
friction to small WIP commits. Pre-push is the right gate — it runs once per
push, before anything reaches the remote.

---

## Secret detection

Two layers, in priority order:

### gitleaks (preferred)

[gitleaks](https://github.com/gitleaks/gitleaks) scans for high-entropy strings,
credential patterns, and known secret formats across 300+ regex rules.

```bash
# Install
brew install gitleaks          # macOS
apt-get install gitleaks       # Debian/Ubuntu
```

The pre-push hook runs per push range so new-branch pushes are handled correctly:

```sh
for range in $RANGES; do
  gitleaks git --no-banner --log-opts="$range"
done
```

Phase 1's pre-commit hook will use `gitleaks protect --staged` (scans only
staged changes, not the full history) for faster feedback on each commit.

### Grep fallback

When gitleaks is not installed the hook falls back to pattern matching the diff:

| Pattern | Catches |
|---|---|
| `AKIA[0-9A-Z]{16}` | AWS IAM long-term access key IDs |
| `ASIA[0-9A-Z]{16}` | AWS STS temporary access key IDs |
| `-----BEGIN (RSA\|EC\|OPENSSH\|DSA\|PGP) PRIVATE KEY` | Private key blocks |
| `[Pp]assword\s*=\s*\S{8,}` | Password assignments |
| `[Ss]ecret\s*[=:]\s*\S{8,}` | Generic secret assignments |

The grep fallback is a safety net — it will miss many real secrets. **Install
gitleaks.**

---

## Phase 1 — Husky setup

Phase 1 establishes the full hook suite for the dashboard monorepo. The simulator
checks are folded into the repo-wide hooks at this point.

### Prerequisites

```bash
pnpm add -D husky @commitlint/cli @commitlint/config-conventional lint-staged
brew install gitleaks
```

### Hook inventory

#### `.husky/pre-commit`

Runs on every `git commit`. Fast — operates only on staged files.

```sh
#!/usr/bin/env sh
. "$(dirname "$0")/_/husky.sh"

# Scan staged changes for secrets before they enter commit history.
gitleaks protect --staged --no-banner

# Lint and format staged dashboard files.
pnpm exec lint-staged
```

`lint-staged` config in `package.json`:

```json
{
  "lint-staged": {
    "apps/dashboard/**/*.{ts,tsx}": ["eslint --fix", "prettier --write"],
    "apps/dashboard/**/*.{json,css,md}": ["prettier --write"],
    "packages/**/*.{ts,tsx}": ["eslint --fix", "prettier --write"]
  }
}
```

> The simulator is excluded from lint-staged — it is not in the pnpm workspace
> and has its own ESLint/Prettier config.

#### `.husky/commit-msg`

Enforces Conventional Commits on every commit message (Rule 31).

```sh
#!/usr/bin/env sh
. "$(dirname "$0")/_/husky.sh"

pnpm exec commitlint --edit "$1"
```

`commitlint.config.ts`:

```ts
import type { UserConfig } from '@commitlint/types'

const config: UserConfig = {
  extends: ['@commitlint/config-conventional'],
}
export default config
```

Allowed types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`.

#### `.husky/pre-push`

Runs once per push. Heavier checks that are too slow for pre-commit.

```sh
#!/usr/bin/env sh
. "$(dirname "$0")/_/husky.sh"

REPO_ROOT="$(git rev-parse --show-toplevel)"
ZERO=$(git hash-object --stdin </dev/null | tr '[0-9a-f]' '0')
RANGES=""

while IFS=" " read -r local_ref local_oid remote_ref remote_oid; do
  [ "$local_oid" = "$ZERO" ] && continue
  if [ "$remote_oid" = "$ZERO" ]; then
    RANGES="$RANGES $local_oid"
  else
    RANGES="$RANGES $remote_oid..$local_oid"
  fi
done

[ -z "$RANGES" ] && exit 0

# Dashboard: full type-check + test suite.
# shellcheck disable=SC2086
if git diff --name-only $RANGES 2>/dev/null | grep -qE "^apps/|^packages/"; then
  echo "→ dashboard: typecheck"
  pnpm exec tsc --noEmit
  echo "→ dashboard: tests"
  pnpm exec vitest run
fi

# Simulator: typecheck + tests (mirrors tools/bedrock-simulator/.hooks/pre-push).
# shellcheck disable=SC2086
if git diff --name-only $RANGES 2>/dev/null | grep -q "^tools/bedrock-simulator/"; then
  echo "→ bedrock-simulator: typecheck"
  (cd "$REPO_ROOT/tools/bedrock-simulator" && pnpm typecheck)
  echo "→ bedrock-simulator: tests"
  (cd "$REPO_ROOT/tools/bedrock-simulator" && pnpm test)
fi

# Secret scan — commits being pushed only, not full history.
echo "→ secret scan (gitleaks)"
# shellcheck disable=SC2086
for range in $RANGES; do
  (cd "$REPO_ROOT" && gitleaks git --no-banner --log-opts="$range")
done

echo "→ all checks passed"
```

### Installation (Phase 1 task)

```bash
# From repo root
pnpm exec husky init           # creates .husky/ and sets core.hooksPath

# Copy the three hook files above into .husky/
# Then make them executable:
chmod +x .husky/pre-commit .husky/commit-msg .husky/pre-push

# Remove the simulator's temporary hook — it is now inactive anyway
# because core.hooksPath points to .husky/, but clean it up explicitly:
(cd tools/bedrock-simulator && pnpm hooks:uninstall)
```

Husky's `prepare` script (`"prepare": "husky"` in root `package.json`) re-installs
hooks automatically for every contributor who runs `pnpm install`.

### Never bypass

`.claude/settings.json` denies `git commit --no-verify` (Rule 50.5). Do not run
`--no-verify` manually either — fix the failing check instead.

---

## Lifecycle summary

```
Today                   Phase 1                     Phase 1+
─────────────────────   ─────────────────────────   ──────────────────────
.git/hooks/pre-push     Husky sets                  .husky/pre-push
  (simulator only)      core.hooksPath=.husky       (dashboard + simulator
  ← installed via       .git/hooks/ bypassed ─────► + secret scan)
  pnpm hooks:install    pnpm hooks:uninstall run
```
