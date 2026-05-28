#!/usr/bin/env bash
set -euo pipefail

# Determine review scope for a pull request event.
#
# Required env vars (passed via workflow `env:` block):
#   REPO          - github.repository (owner/repo)
#   PR_NUMBER     - github.event.pull_request.number
#   EVENT_ACTION  - github.event.action
#   EVENT_BEFORE  - github.event.before
#   CURRENT_SHA   - github.sha
#   GH_TOKEN      - secrets.GITHUB_TOKEN (for gh api calls)
#
# Outputs written to $GITHUB_OUTPUT:
#   type              - "incremental" or "full"
#   files             - comma-separated filenames (incremental only)
#   security_relevant - "true" or "false"

# shellcheck source=lib/sensitive-paths.sh
source "$(dirname "$0")/lib/sensitive-paths.sh"

# synchronize with a real base → incremental correctness only.
# Everything else (opened/reopened/ready_for_review/force-push) → full
# correctness + security in a single Claude invocation.
if [[ "$EVENT_ACTION" == "synchronize" && "$EVENT_BEFORE" != "0000000000000000000000000000000000000000" ]]; then
  FILES=$(gh api "repos/${REPO}/compare/${EVENT_BEFORE}...${CURRENT_SHA}" \
    --jq '[.files[].filename] | join(", ")' 2>/dev/null || echo "")
  echo "type=incremental" >> "$GITHUB_OUTPUT"
  echo "files=${FILES}" >> "$GITHUB_OUTPUT"
  echo "**Scope:** incremental — \`${FILES}\`" >> "$GITHUB_STEP_SUMMARY"
else
  echo "type=full" >> "$GITHUB_OUTPUT"
  echo "**Scope:** full (\`${EVENT_ACTION}\`)" >> "$GITHUB_STEP_SUMMARY"
fi

# Security-sensitive paths drive whether the full review's prompt also
# includes the security audit block (and emits a security-summary for
# downstream comment/reject handling).
HITS=$(gh api "repos/${REPO}/pulls/${PR_NUMBER}/files" --paginate \
  --jq '.[].filename' \
  | grep -Ec "$SENSITIVE" || true)
if [[ "$HITS" -gt 0 ]]; then
  echo "security_relevant=true" >> "$GITHUB_OUTPUT"
  echo "**Security audit:** running (${HITS} sensitive file(s) changed)" >> "$GITHUB_STEP_SUMMARY"
else
  echo "security_relevant=false" >> "$GITHUB_OUTPUT"
  echo "**Security audit:** skipped (no sensitive paths changed)" >> "$GITHUB_STEP_SUMMARY"
fi
