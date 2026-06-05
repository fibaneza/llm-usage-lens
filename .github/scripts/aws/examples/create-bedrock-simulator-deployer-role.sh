#!/usr/bin/env bash
# .github/scripts/aws/examples/create-bedrock-simulator-deployer-role.sh
#
# Worked example of calling the project-generic engine
# .github/scripts/aws/create-deployer-role.sh. It provisions the GitHub Actions OIDC
# "deployer" role used by the bedrock-simulator CI/CD pipeline.
#
# This is a PIPELINE concern, deliberately kept OUT of the bedrock-simulator app
# bootstrap (tools/bedrock-simulator/bootstrap.sh) — that script only deploys the
# stack, which creates the app's OWN roles. Run this once with operator SSO
# credentials so GitHub Actions can deploy/destroy from scratch.
#
# Copy this file as a template when adding a deployer role for another app:
# change ROLE_NAME, the workflow list, and the policy files.
#
# Usage:
#   .github/scripts/aws/examples/create-bedrock-simulator-deployer-role.sh [--profile P] \
#     [--account ID] [--owner OWNER] [--repo REPO] [--env ENV] [--delete]
#
# Account ID / GitHub owner are read from the gitignored
# tools/bedrock-simulator/.bootstrap.env when present, or passed as flags.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || (cd "$SCRIPT_DIR/../../../.." && pwd))"
ENGINE="$REPO_ROOT/.github/scripts/aws/create-deployer-role.sh"
POLICY_DIR="$REPO_ROOT/.github/scripts/aws/iam"
ENV_FILE="$REPO_ROOT/.github/scripts/aws/.env"

# ── the bedrock-simulator-specific inputs (what you'd customise per app) ───────
ROLE_NAME="bedrock-simulator-deployer"
GITHUB_REPO="aws-bedrock-cost-tracker"
GITHUB_ENV="bedrock-simulator-sandbox"
# The three AWS-touching workflow files the role is allowed to run from, pinned
# to main. bedrock-simulator-build.yml is excluded on purpose (it touches no AWS).
WORKFLOW_FILES=(
  bedrock-simulator-deploy.yml
  bedrock-simulator-run.yml
  bedrock-simulator-destroy.yml
)

# ── values shared with bootstrap.sh, sourced from .bootstrap.env if present ────
PROFILE="${AWS_PROFILE:-bedrock-simulator-sandbox}"
ACCOUNT_ID=""
GITHUB_OWNER=""
REGION="us-east-1"
DELETE=false

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck source=/dev/null
  source "$ENV_FILE"
fi

while [[ $# -gt 0 ]]; do
  case $1 in
    --profile) PROFILE="$2";      shift 2 ;;
    --account) ACCOUNT_ID="$2";   shift 2 ;;
    --owner)   GITHUB_OWNER="$2"; shift 2 ;;
    --repo)    GITHUB_REPO="$2";  shift 2 ;;
    --env)     GITHUB_ENV="$2";   shift 2 ;;
    --region)  REGION="$2";       shift 2 ;;
    --delete)  DELETE=true;       shift ;;
    --help)    sed -n '/^# Usage/,/^[^#]/p' "$0" | head -n -1 | sed 's/^# \?//'; exit 0 ;;
    *) echo "Unknown option: $1  (run with --help)" >&2; exit 1 ;;
  esac
done

[[ -x "$ENGINE" ]] || { echo "✗  engine not found/executable: $ENGINE" >&2; exit 1; }

# Teardown needs only the role name.
if [[ "$DELETE" == true ]]; then
  exec "$ENGINE" --role-name "$ROLE_NAME" --profile "$PROFILE" --delete
fi

[[ -n "$GITHUB_OWNER" ]] || { echo "✗  GITHUB_OWNER not set (use --owner or .bootstrap.env)." >&2; exit 1; }

# Build the --workflow flags as job_workflow_ref values.
WF_BASE="$GITHUB_OWNER/$GITHUB_REPO/.github/workflows"
WF_ARGS=()
for wf in "${WORKFLOW_FILES[@]}"; do
  WF_ARGS+=(--workflow "$WF_BASE/$wf@refs/heads/main")
done

exec "$ENGINE" \
  --role-name "$ROLE_NAME" \
  --profile "$PROFILE" \
  ${ACCOUNT_ID:+--account "$ACCOUNT_ID"} \
  --region "$REGION" \
  --owner "$GITHUB_OWNER" \
  --repo "$GITHUB_REPO" \
  --env "$GITHUB_ENV" \
  --description "Assumed by GitHub Actions via OIDC to deploy/destroy the bedrock-simulator stack." \
  "${WF_ARGS[@]}" \
  --policy "cfn-and-artifacts=$POLICY_DIR/deployer-cfn-and-artifacts.json" \
  --policy "stack-resources=$POLICY_DIR/deployer-stack-resources.json"
