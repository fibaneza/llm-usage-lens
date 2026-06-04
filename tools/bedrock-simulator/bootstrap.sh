#!/usr/bin/env bash
# bootstrap.sh — one-time setup for the bedrock-simulator SAM stack.
#
# Solves the chicken-and-egg problem: bedrock-simulator-deploy.yml assumes the
# bedrock-simulator-deployer OIDC role, but that role is a CloudFormation
# resource that only exists after the first stack deploy. Run this script once
# with your SSO credentials. After it succeeds, all future deploys go through
# GitHub Actions (OIDC — no static credentials, no local commands needed).
#
# Usage (from tools/bedrock-simulator/):
#   ./bootstrap.sh [options]
#
# Options:
#   --profile    <name>   AWS SSO profile to use (default: bedrock-simulator-sandbox)
#   --account    <id>     Sandbox AWS account ID (default: 747064923676)
#   --owner      <name>   GitHub owner / username (default: fibaneza)
#   --repo       <name>   GitHub repository name (default: aws-bedrock-cost-tracker)
#   --email      <addr>   Email for the AWS Budget alarm (prompted if omitted)
#   --kms                 Enable KMS encryption for invocation logs (~$1/month extra)
#   --skip-build          Skip pnpm install + pnpm build (use existing .aws-sam/)
#   --help

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── defaults ─────────────────────────────────────────────────────────────────
PROFILE="${AWS_PROFILE:-bedrock-simulator-sandbox}"
ACCOUNT_ID="747064923676"
GITHUB_OWNER="fibaneza"
GITHUB_REPO="aws-bedrock-cost-tracker"
GITHUB_ENV="bedrock-simulator-sandbox"
BUDGET_EMAIL=""
KMS_ENCRYPTION="false"
SKIP_BUILD=false
STACK_NAME="bedrock-simulator"
REGION="us-east-1"

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
      sed -n '/^# Usage/,/^[^#]/p' "$0" | head -n -1 | sed 's/^# \?//'
      exit 0
      ;;
    *) echo "Unknown option: $1  (run with --help)" >&2; exit 1 ;;
  esac
done

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

# ── GitHub OIDC IdP ───────────────────────────────────────────────────────────
step "GitHub OIDC identity provider"

OIDC_ARN=$(aws iam list-open-id-connect-providers \
  --query 'OpenIDConnectProviderList[?contains(Arn,`token.actions.githubusercontent.com`)].Arn' \
  --output text)

if [[ -n "$OIDC_ARN" ]]; then
  ok "Already exists: $OIDC_ARN"
else
  info "Not found — creating..."
  aws iam create-open-id-connect-provider \
    --url https://token.actions.githubusercontent.com \
    --client-id-list sts.amazonaws.com \
    --thumbprint-list \
      6938fd4d98bab03faadb97b34396831e3780aea1 \
      1c58a3a8518e8759bf075b76b750d4f2df264fcd \
    --query 'OpenIDConnectProviderArn' --output text
  ok "OIDC IdP created"
fi

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
    -e "s/GitHubRepo=aws-bedrock-cost-tracker/GitHubRepo=$GITHUB_REPO/" \
    -e "s/GitHubEnvironment=bedrock-simulator-sandbox/GitHubEnvironment=$GITHUB_ENV/" \
    -e "s/BudgetAlertEmail=REPLACE_ME/BudgetAlertEmail=$BUDGET_EMAIL/" \
    -e "s/UseKmsEncryption=false/UseKmsEncryption=$KMS_ENCRYPTION/" \
    samconfig.toml.example > samconfig.toml
  ok "samconfig.toml written"
  info "(Gitignored — do not commit it.)"
fi

# ── deploy ────────────────────────────────────────────────────────────────────
step "Deploying stack '$STACK_NAME' to $REGION"
info "This creates the bedrock-simulator-deployer OIDC role and all other resources."
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
echo "  The bedrock-simulator-deployer OIDC role now exists in account $ACCOUNT_ID."
echo "  All future deploys go through GitHub Actions:"
echo ""
echo "    gh workflow run bedrock-simulator-deploy.yml -f confirm=deploy"
echo ""
echo "  Remaining one-time steps:"
echo "    □ Confirm the AWS Budget SNS email subscription"
echo "      (check inbox for an AWS Notification message, click 'Confirm subscription')"
echo "    □ Flag Prerequisite #6 (CloudTrail Bedrock data events) to the Phase 6 owner"
echo ""
