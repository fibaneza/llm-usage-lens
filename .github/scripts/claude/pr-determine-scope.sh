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
#   type              - "incremental" or "full-pr"
#   files             - comma-separated filenames (incremental only)
#   security_relevant - "true" or "false"
#
# Also renders one scope summary block (mode, security decision, collapsed
# file list) to $GITHUB_STEP_SUMMARY and the step log.

# shellcheck source=lib/sensitive-paths.sh
source "$(dirname "$0")/lib/sensitive-paths.sh"

# The PR's complete changed-file list. Drives the security decision in every
# mode, and is the review scope for full-PR reviews. A gh api failure here must
# abort (pipefail) rather than silently narrow scope to an empty list.
PR_FILES=$(gh api "repos/${REPO}/pulls/${PR_NUMBER}/files" --paginate --jq '.[].filename')

# synchronize with a real base → incremental correctness only (review just the
# push delta). Everything else (opened/reopened/ready_for_review/force-push) →
# full-PR correctness + security in a single Claude invocation.
if [[ "$EVENT_ACTION" == "synchronize" && "$EVENT_BEFORE" != "0000000000000000000000000000000000000000" ]]; then
  REVIEW_FILES=$(gh api "repos/${REPO}/compare/${EVENT_BEFORE}...${CURRENT_SHA}" \
    --jq '.files[].filename')
  FILES_CSV=$(echo "$REVIEW_FILES" | sed '/^$/d' | awk 'NR>1{printf ", "}{printf "%s", $0}')
  echo "type=incremental" >> "$GITHUB_OUTPUT"
  echo "files=${FILES_CSV}" >> "$GITHUB_OUTPUT"
  MODE_LABEL="incremental"
else
  REVIEW_FILES="$PR_FILES"
  echo "type=full-pr" >> "$GITHUB_OUTPUT"
  MODE_LABEL="full-PR (\`${EVENT_ACTION}\`)"
fi

# Security-sensitive paths drive whether the full-PR review's prompt also
# includes the security audit block. Matched against the whole PR regardless of
# review mode.
HITS=$(echo "$PR_FILES" | grep -Ec "$SENSITIVE" || true)
if [[ "$HITS" -gt 0 ]]; then
  echo "security_relevant=true" >> "$GITHUB_OUTPUT"
  SEC_LABEL="running (${HITS} sensitive file(s))"
else
  echo "security_relevant=false" >> "$GITHUB_OUTPUT"
  SEC_LABEL="skipped (no sensitive paths)"
fi

FILE_COUNT=$(echo "$REVIEW_FILES" | grep -c . || true)

# One coherent summary block. The file list is collapsed so a large PR doesn't
# flood the run summary; `tee` mirrors it into the step log too.
{
  echo "### Claude PR Review — scope"
  echo "**Mode:** ${MODE_LABEL} · **Security audit:** ${SEC_LABEL}"
  echo ""
  echo "<details><summary><b>Files under review (${FILE_COUNT})</b></summary>"
  echo ""
  echo "$REVIEW_FILES" | sed '/^$/d; s/^/- /'
  echo ""
  echo "</details>"
} | tee -a "$GITHUB_STEP_SUMMARY"
