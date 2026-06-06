#!/usr/bin/env bash
# .github/scripts/aws/create-bedrock-simulator-deployer-role.sh
#
# Provisions the GitHub Actions OIDC "deployer" role used by the
# bedrock-simulator CI/CD pipeline. This is the script you actually run; it
# feeds the bedrock-simulator-specific inputs (role name, workflow trust pins,
# permission policies) to the project-generic engine
# .github/scripts/aws/lib/create-deployer-role.sh.
#
# This is a PIPELINE concern, deliberately kept OUT of the bedrock-simulator app
# bootstrap (tools/bedrock-simulator/bootstrap.sh) — that script only deploys the
# stack, which creates the app's OWN roles. Run this once with operator SSO
# credentials so GitHub Actions can deploy/destroy from scratch.
#
# All configuration is read from .github/scripts/aws/.env (copy .env.example to
# .env and fill it in). There are no configuration flags — edit .env instead.
#
# Usage:
#   .github/scripts/aws/create-bedrock-simulator-deployer-role.sh           # create / update
#   .github/scripts/aws/create-bedrock-simulator-deployer-role.sh --delete  # tear down
#
# Copy this file as a template when adding a deployer role for another app:
# change ROLE_NAME, the workflow list, and the policy files.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || (cd "$SCRIPT_DIR/../../.." && pwd))"
ENGINE="$REPO_ROOT/.github/scripts/aws/lib/create-deployer-role.sh"
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

# ── only mode flags are accepted; all config comes from .env ───────────────────
DELETE=false
case "${1:-}" in
  "")        ;;
  --delete)  DELETE=true ;;
  --help)    sed -n '/^# Usage/,/^[^#]/p' "$0" | head -n -1 | sed 's/^# \?//'; exit 0 ;;
  *) echo "Unknown option: $1  (run with --help; configuration lives in .env)" >&2; exit 1 ;;
esac

# ── configuration: read from .env ──────────────────────────────────────────────
# Defaults apply only when .env omits the value.
PROFILE="${AWS_PROFILE:-bedrock-simulator-sandbox}"
ACCOUNT_ID=""
GITHUB_OWNER=""
REGION="us-east-1"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck source=/dev/null
  source "$ENV_FILE"
else
  echo "✗  config not found: $ENV_FILE" >&2
  echo "   copy ${ENV_FILE%/*}/.env.example to $ENV_FILE and fill it in." >&2
  exit 1
fi

[[ -x "$ENGINE" ]] || { echo "✗  engine not found/executable: $ENGINE" >&2; exit 1; }

# Teardown needs only the role name.
if [[ "$DELETE" == true ]]; then
  exec "$ENGINE" --role-name "$ROLE_NAME" --profile "$PROFILE" --delete
fi

[[ -n "$GITHUB_OWNER" ]] || { echo "✗  GITHUB_OWNER not set in $ENV_FILE." >&2; exit 1; }

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
