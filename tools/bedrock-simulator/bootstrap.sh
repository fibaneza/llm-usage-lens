#!/usr/bin/env bash
# bootstrap.sh — one-time LOCAL deploy of the bedrock-simulator SAM stack.
#
# Builds the Lambda bundle and runs `sam deploy` with your SSO credentials. The
# stack creates the bedrock-simulator app's OWN IAM roles (SimUserRole-*, the
# Lambda execution roles) — that is the only kind of role this script provisions.
#
# It does NOT create the GitHub Actions "deployer" OIDC role: that is a CI/CD
# PIPELINE concern, not part of the app. `sam deploy` does not need it (locally
# you authenticate with SSO; in CI the workflow assumes it). Provision that
# pipeline role separately, once, with:
#
#   .github/scripts/aws/create-bedrock-simulator-deployer-role.sh
#   # (a thin wrapper around the generic .github/scripts/aws/lib/create-deployer-role.sh)
#
# Usage (from tools/bedrock-simulator/):
#   ./bootstrap.sh [options]
#
# Per-user values (account ID, GitHub owner, budget email) are NOT hardcoded
# here — they live in a gitignored .bootstrap.env so real account IDs never
# land in the repo. Copy .bootstrap.env.example to .bootstrap.env and fill it
# in. CLI flags below override anything sourced from that file.
#
# Options:
#   --profile    <name>   AWS SSO profile to use (default: bedrock-simulator-sandbox)
#   --account    <id>     Sandbox AWS account ID (required; or set in .bootstrap.env)
#   --owner      <name>   GitHub owner / username (required; or set in .bootstrap.env)
#   --repo       <name>   GitHub repository name (default: llm-usage-lens)
#   --email      <addr>   Email for the AWS Budget alarm (prompted if omitted)
#   --kms                 Enable KMS encryption for invocation logs (~$1/month extra)
#   --skip-build          Skip pnpm install + pnpm build (use existing .aws-sam/)
#   --help

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── defaults ─────────────────────────────────────────────────────────────────
# Built-in defaults only. Per-user / sensitive values (ACCOUNT_ID, GITHUB_OWNER,
# BUDGET_EMAIL) are intentionally left empty here and sourced from .bootstrap.env
# below. Precedence: CLI flags > .bootstrap.env > these defaults.
PROFILE="${AWS_PROFILE:-bedrock-simulator-sandbox}"
ACCOUNT_ID=""
GITHUB_OWNER=""
GITHUB_REPO="llm-usage-lens"
GITHUB_ENV="bedrock-simulator-sandbox"
BUDGET_EMAIL=""
KMS_ENCRYPTION="false"
SKIP_BUILD=false
STACK_NAME="bedrock-simulator"
REGION="us-east-1"

# ── local overrides (gitignored, optional) ────────────────────────────────────
# .bootstrap.env holds your sandbox account ID and GitHub owner. It is gitignored
# (see .gitignore) — never commit it. Copy .bootstrap.env.example to create it.
ENV_FILE="$SCRIPT_DIR/.bootstrap.env"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck source=/dev/null
  source "$ENV_FILE"
fi

# ── argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case $1 in
    --profile)     PROFILE="$2";        shift 2 ;;
    --account)     ACCOUNT_ID="$2";     shift 2 ;;
    --owner)       GITHUB_OWNER="$2";   shift 2 ;;
    --repo)        GITHUB_REPO="$2";    shift 2 ;;
    --email)       BUDGET_EMAIL="$2";   shift 2 ;;
    --kms)         KMS_ENCRYPTION="true"; shift ;;
    --skip-build)  SKIP_BUILD=true;     shift ;;
    --help)
      # Absolute self-path: cwd was changed to $SCRIPT_DIR above, so a relative
      # $0 would not resolve when invoked by path from elsewhere.
      sed -n '/^# Usage/,/^[^#]/p' "$SCRIPT_DIR/$(basename "${BASH_SOURCE[0]}")" \
        | head -n -1 | sed 's/^# \?//'
      exit 0
      ;;
    *) echo "Unknown option: $1  (run with --help)" >&2; exit 1 ;;
  esac
done

# ── required values ────────────────────────────────────────────────────────────
if [[ -z "$ACCOUNT_ID" || "$ACCOUNT_ID" == "000000000000" ]]; then
  echo "✗  ACCOUNT_ID is not set." >&2
  echo "   Set it in .bootstrap.env (copy .bootstrap.env.example) or pass --account <id>." >&2
  exit 1
fi
if [[ -z "$GITHUB_OWNER" ]]; then
  echo "✗  GITHUB_OWNER is not set." >&2
  echo "   Set it in .bootstrap.env (copy .bootstrap.env.example) or pass --owner <name>." >&2
  exit 1
fi

# ── helpers ───────────────────────────────────────────────────────────────────
bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m  %s\n' "$*"; }
err()  { printf '  \033[31m✗\033[0m  %s\n' "$*" >&2; }
step() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }

# ── preflight ─────────────────────────────────────────────────────────────────
step "Checking prerequisites"

for cmd in aws sam pnpm; do
  if command -v "$cmd" &>/dev/null; then
    ok "$cmd found"
  else
    err "$cmd not found — install it and retry"
    exit 1
  fi
done

# ── prompt for missing email ──────────────────────────────────────────────────
if [[ -z "$BUDGET_EMAIL" ]]; then
  printf '\n  Budget alert email (for the $10/month AWS Budget alarm): '
  read -r BUDGET_EMAIL
  [[ -z "$BUDGET_EMAIL" ]] && { err "Email is required."; exit 1; }
fi

# ── AWS credentials ───────────────────────────────────────────────────────────
step "Verifying AWS credentials (profile: $PROFILE)"

export AWS_PROFILE="$PROFILE"

if ! ACTUAL_ACCOUNT=$(aws sts get-caller-identity --query Account --output text 2>&1); then
  err "Could not get caller identity. Is '$PROFILE' configured and logged in?"
  info "Run:  aws sso login --profile $PROFILE"
  exit 1
fi

if [[ "$ACTUAL_ACCOUNT" != "$ACCOUNT_ID" ]]; then
  err "Profile '$PROFILE' resolves to account $ACTUAL_ACCOUNT, expected $ACCOUNT_ID"
  info "Pass the correct account with --account or fix the profile."
  exit 1
fi

ok "Account $ACTUAL_ACCOUNT confirmed"

# ── build ─────────────────────────────────────────────────────────────────────
if [[ "$SKIP_BUILD" == true ]]; then
  step "Skipping build (--skip-build)"
  if [[ ! -f .aws-sam/build/template.yaml ]]; then
    err ".aws-sam/build/template.yaml not found — remove --skip-build and try again."
    exit 1
  fi
  ok "Using existing .aws-sam/"
else
  step "Installing dependencies"
  pnpm install --frozen-lockfile

  step "Building (typecheck → esbuild → sam build)"
  pnpm build
  ok "Build complete"
fi

# ── samconfig.toml ────────────────────────────────────────────────────────────
step "Configuring samconfig.toml"

if [[ -f samconfig.toml ]]; then
  ok "samconfig.toml already exists — using it as-is"
  info "(Delete it to regenerate from scratch.)"
else
  info "Generating samconfig.toml from example..."
  sed \
    -e "s/stack_name = .*/stack_name = \"$STACK_NAME\"/" \
    -e "s/SandboxAccountId=000000000000/SandboxAccountId=$ACCOUNT_ID/" \
    -e "s/GitHubOwner=REPLACE_ME/GitHubOwner=$GITHUB_OWNER/" \
    -e "s/GitHubRepo=llm-usage-lens/GitHubRepo=$GITHUB_REPO/" \
    -e "s/GitHubEnvironment=bedrock-simulator-sandbox/GitHubEnvironment=$GITHUB_ENV/" \
    -e "s/BudgetAlertEmail=REPLACE_ME/BudgetAlertEmail=$BUDGET_EMAIL/" \
    -e "s/UseKmsEncryption=false/UseKmsEncryption=$KMS_ENCRYPTION/" \
    samconfig.toml.example > samconfig.toml
  ok "samconfig.toml written"
  info "(Gitignored — do not commit it.)"
fi

# ── deploy ────────────────────────────────────────────────────────────────────
step "Deploying stack '$STACK_NAME' to $REGION"
info "This creates all stack resources, including the app's own IAM roles (SimUserRole-*, Lambda roles)."
info "First deploy typically takes 3–5 minutes."
echo ""

sam deploy \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --capabilities CAPABILITY_NAMED_IAM \
  --no-confirm-changeset \
  --no-fail-on-empty-changeset \
  --resolve-s3

# ── verify ────────────────────────────────────────────────────────────────────
step "Verifying stack status"

STATUS=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" --region "$REGION" \
  --query 'Stacks[0].StackStatus' --output text)

if [[ "$STATUS" == "CREATE_COMPLETE" || "$STATUS" == "UPDATE_COMPLETE" ]]; then
  ok "Stack status: $STATUS"
else
  err "Stack status: $STATUS — expected CREATE_COMPLETE or UPDATE_COMPLETE"
  info "Check stack events:"
  info "  aws cloudformation describe-stack-events --stack-name $STACK_NAME \\"
  info "    --query 'StackEvents[?contains(ResourceStatus,\`FAILED\`)].[LogicalResourceId,ResourceStatusReason]' \\"
  info "    --output table"
  info ""
  info "If the stack is in ROLLBACK_COMPLETE, delete it before retrying:"
  info "  aws cloudformation delete-stack --stack-name $STACK_NAME"
  info "  aws cloudformation wait stack-delete-complete --stack-name $STACK_NAME"
  exit 1
fi

# ── done ──────────────────────────────────────────────────────────────────────
echo ""
bold "Bootstrap complete."
echo ""
echo "  The bedrock-simulator stack is deployed in account $ACCOUNT_ID."
echo ""
echo "  To deploy via GitHub Actions instead of locally, first provision the"
echo "  pipeline deployer role (one-time, separate from this app bootstrap):"
echo ""
echo "    .github/scripts/aws/create-bedrock-simulator-deployer-role.sh"
echo ""
echo "  Then: gh workflow run bedrock-simulator-deploy.yml -f confirm=deploy"
echo ""
echo "  Remaining one-time steps:"
echo "    □ Confirm the AWS Budget SNS email subscription"
echo "      (check inbox for an AWS Notification message, click 'Confirm subscription')"
echo "    □ Flag Prerequisite #6 (CloudTrail Bedrock data events) to the Phase 6 owner"
echo ""
