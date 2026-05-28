#!/usr/bin/env bash
set -euo pipefail

# Determine audit scope for a release-tag push or workflow_dispatch run.
#
# Required env vars (passed via workflow `env:` block):
#   REPO           - github.repository (owner/repo)
#   CURRENT_SHA    - github.sha
#   INPUT_FROM_REF - inputs.from_ref (may be empty)
#   INPUT_TO_REF   - inputs.to_ref   (may be empty)
#   GH_TOKEN       - secrets.GITHUB_TOKEN
#
# Outputs written to $GITHUB_OUTPUT:
#   skip_audit        - "true" or "false"
#   files             - newline-delimited kept file paths
#   removed_files     - newline-delimited deleted file paths
#   security_relevant - "true" or "false"

# shellcheck source=lib/sensitive-paths.sh
source "$(dirname "$0")/lib/sensitive-paths.sh"

HEAD="${INPUT_TO_REF:-${CURRENT_SHA}}"

# Resolve base ref: prefer explicit dispatch input, then previous release tag.
if [[ -n "${INPUT_FROM_REF:-}" ]]; then
  BASE="$INPUT_FROM_REF"
  echo "**Scope:** dispatch — \`${BASE}\` → \`${HEAD:0:7}\`" >> "$GITHUB_STEP_SUMMARY"
else
  PREV_TAG=$(git describe --tags --abbrev=0 \
    --match 'v*' --match '*-rc*' --match '*-beta*' \
    "${CURRENT_SHA}^" 2>/dev/null || true)

  if [[ -z "$PREV_TAG" ]]; then
    # First release ever — no prior anchor to diff against. Establish baseline.
    echo "skip_audit=true" >> "$GITHUB_OUTPUT"
    echo "**Result:** baseline established — first release tag, no prior anchor to diff against" >> "$GITHUB_STEP_SUMMARY"
    exit 0
  fi

  BASE="$PREV_TAG"
  echo "**Scope:** release delta — \`${PREV_TAG}\` → \`${HEAD:0:7}\`" >> "$GITHUB_STEP_SUMMARY"
fi

# Already audited (same base and head)?
if [[ "$BASE" == "$HEAD" ]]; then
  echo "skip_audit=true" >> "$GITHUB_OUTPUT"
  echo "**Result:** already audited — skipping" >> "$GITHUB_STEP_SUMMARY"
  exit 0
fi

# Compute changed files via GitHub compare API. Failing gh api here would
# silently set skip_audit=true (no files → skip), which would suppress the
# entire release audit on a transient error. Let pipefail surface it instead.
KEPT=$(gh api "repos/${REPO}/compare/${BASE}...${HEAD}" --paginate \
  --jq '.files[] | select(.status != "removed") | .filename')
REMOVED=$(gh api "repos/${REPO}/compare/${BASE}...${HEAD}" --paginate \
  --jq '[.files[] | select(.status == "removed") | .filename] | join("\n")')

if [[ -z "$KEPT" && -z "$REMOVED" ]]; then
  echo "skip_audit=true" >> "$GITHUB_OUTPUT"
  echo "**Result:** no files changed — skipping" >> "$GITHUB_STEP_SUMMARY"
  exit 0
fi

# Write multi-line outputs via heredoc form.
{
  echo "files<<EOF"
  echo "$KEPT"
  echo "EOF"
} >> "$GITHUB_OUTPUT"
{
  echo "removed_files<<EOF"
  echo "$REMOVED"
  echo "EOF"
} >> "$GITHUB_OUTPUT"
echo "skip_audit=false" >> "$GITHUB_OUTPUT"

# Determine security relevance.
ALL_FILES=$(printf '%s\n%s' "$KEPT" "$REMOVED")
HITS=$(echo "$ALL_FILES" | grep -Ec "$SENSITIVE" || true)
if [[ "$HITS" -gt 0 ]]; then
  echo "security_relevant=true" >> "$GITHUB_OUTPUT"
  echo "**Security audit:** running (${HITS} sensitive file(s) changed)" >> "$GITHUB_STEP_SUMMARY"
else
  echo "security_relevant=false" >> "$GITHUB_OUTPUT"
  echo "**Security audit:** skipped (no sensitive paths changed)" >> "$GITHUB_STEP_SUMMARY"
fi

KEPT_COUNT=$(echo "$KEPT" | grep -c . || true)
REMOVED_COUNT=$(echo "$REMOVED" | grep -c . || true)
echo "**Files:** ${KEPT_COUNT} changed, ${REMOVED_COUNT} removed" >> "$GITHUB_STEP_SUMMARY"
