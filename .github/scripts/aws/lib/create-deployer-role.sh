#!/usr/bin/env bash
# .github/scripts/aws/lib/create-deployer-role.sh — generic GitHub-OIDC deployer-role provisioner.
#
# Project-agnostic. Creates (or updates) an IAM role that GitHub Actions can
# assume via OIDC, with a trust policy pinned to a repository and — optionally —
# a GitHub Environment and/or specific workflow files, plus one or more
# caller-supplied inline permission policies. Also ensures the account-shared
# GitHub OIDC identity provider (token.actions.githubusercontent.com) exists.
#
# It hard-codes NOTHING about any one app: the role name, trust pins, and
# permission policies are all supplied by the caller. Per-app wrappers
# (e.g. .github/scripts/aws/create-bedrock-simulator-deployer-role.sh) fill
# in their own values. See docs/specs/2026-05-24-bedrock-simulator.md for the first consumer.
#
# Usage:
#   .github/scripts/aws/lib/create-deployer-role.sh --role-name NAME --owner OWNER --repo REPO \
#     [--env ENVNAME] [--workflow REF ...] [--policy NAME=PATH ...] [options]
#   .github/scripts/aws/lib/create-deployer-role.sh --role-name NAME --delete
#
# Example (provision the bedrock-simulator pipeline deployer role):
#   .github/scripts/aws/lib/create-deployer-role.sh \
#     --role-name bedrock-simulator-deployer \
#     --owner my-org --repo llm-usage-lens \
#     --env bedrock-simulator-sandbox \
#     --workflow my-org/llm-usage-lens/.github/workflows/bedrock-simulator-deploy.yml@refs/heads/main \
#     --policy cfn-and-artifacts=.github/scripts/aws/iam/deployer-cfn-and-artifacts.json \
#     --policy stack-resources=.github/scripts/aws/iam/deployer-stack-resources.json
#   # …or just run the ready-made wrapper that fills all of the above in:
#   .github/scripts/aws/create-bedrock-simulator-deployer-role.sh
#
# Policy JSON files may contain the tokens __ACCOUNT_ID__, __REGION__ and
# __PARTITION__; they are substituted before the policy is attached. Keeping
# real account IDs out of the files lets them be committed safely (Rule 50).
#
# Options:
#   --role-name  NAME      IAM role to create/update/delete (required)
#   --owner      OWNER     GitHub owner / org (required unless --delete)
#   --repo       REPO      GitHub repository name (required unless --delete)
#   --env        NAME      GitHub Environment — adds a `:environment:NAME` sub pin
#   --sub        VALUE     Raw `sub` claim value to allow (repeatable)
#   --workflow   REF       Raw `job_workflow_ref` value to allow (repeatable)
#   --policy     NAME=PATH Inline policy name + JSON file (repeatable)
#   --account    ID        AWS account id (default: resolved via STS)
#   --region     REGION    AWS region for token substitution (default: us-east-1)
#   --partition  PART      AWS partition for token substitution (default: aws)
#   --profile    NAME      AWS profile to export as AWS_PROFILE
#   --description TEXT     Role description
#   --max-session SECS     MaxSessionDuration (default: 3600)
#   --delete               Delete the role and all its inline policies, then exit
#   --help

set -euo pipefail

# ── defaults ─────────────────────────────────────────────────────────────────
ROLE_NAME=""
GITHUB_OWNER=""
GITHUB_REPO=""
GITHUB_ENV=""
ACCOUNT_ID=""
REGION="us-east-1"
PARTITION="aws"
PROFILE="${AWS_PROFILE:-}"
DESCRIPTION="Assumed by GitHub Actions via OIDC."
MAX_SESSION="3600"
DELETE=false
SUBS=()
WORKFLOWS=()
POLICY_NAMES=()
POLICY_PATHS=()

# ── argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case $1 in
    --role-name)   ROLE_NAME="$2";    shift 2 ;;
    --owner)       GITHUB_OWNER="$2"; shift 2 ;;
    --repo)        GITHUB_REPO="$2";  shift 2 ;;
    --env)         GITHUB_ENV="$2";   shift 2 ;;
    --sub)         SUBS+=("$2");      shift 2 ;;
    --workflow)    WORKFLOWS+=("$2"); shift 2 ;;
    --policy)
      [[ "$2" == *=* ]] || { echo "✗  --policy expects NAME=PATH (got '$2')" >&2; exit 1; }
      POLICY_NAMES+=("${2%%=*}")
      POLICY_PATHS+=("${2#*=}")
      shift 2 ;;
    --account)     ACCOUNT_ID="$2";   shift 2 ;;
    --region)      REGION="$2";       shift 2 ;;
    --partition)   PARTITION="$2";    shift 2 ;;
    --profile)     PROFILE="$2";      shift 2 ;;
    --description) DESCRIPTION="$2";  shift 2 ;;
    --max-session) MAX_SESSION="$2";  shift 2 ;;
    --delete)      DELETE=true;       shift ;;
    --help)
      sed -n '/^# Usage/,/^[^#]/p' "${BASH_SOURCE[0]}" | head -n -1 | sed 's/^# \?//'
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

# Emit a JSON array of the remaining args: "a" "b" → ["a","b"]. Empty → nothing
# (caller decides whether to include the key at all).
json_string_array() {
  local out="" first=1 v
  for v in "$@"; do
    [[ $first -eq 1 ]] && first=0 || out+=","
    out+="\"$v\""
  done
  printf '[%s]' "$out"
}

OIDC_HOST="token.actions.githubusercontent.com"

# ── required values ────────────────────────────────────────────────────────────
[[ -n "$ROLE_NAME" ]] || { err "--role-name is required."; exit 1; }
[[ -n "$PROFILE" ]] && export AWS_PROFILE="$PROFILE"

command -v aws &>/dev/null || { err "aws not found — install it and retry"; exit 1; }

# Resolve the account from STS when not provided; verify a match when it is.
step "Verifying AWS credentials${PROFILE:+ (profile: $PROFILE)}"
if ! STS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text 2>&1); then
  err "Could not get caller identity. Are your credentials configured / logged in?"
  [[ -n "$PROFILE" ]] && info "Run:  aws sso login --profile $PROFILE"
  exit 1
fi
if [[ -z "$ACCOUNT_ID" ]]; then
  ACCOUNT_ID="$STS_ACCOUNT"
elif [[ "$ACCOUNT_ID" != "$STS_ACCOUNT" ]]; then
  err "Credentials resolve to account $STS_ACCOUNT, but --account is $ACCOUNT_ID"
  exit 1
fi
ok "Account $ACCOUNT_ID confirmed"

ROLE_ARN="arn:${PARTITION}:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"

# ── teardown ──────────────────────────────────────────────────────────────────
if [[ "$DELETE" == true ]]; then
  step "Deleting role $ROLE_NAME"
  if ! aws iam get-role --role-name "$ROLE_NAME" &>/dev/null; then
    ok "Role does not exist — nothing to delete"
    exit 0
  fi
  # Inline policies must be removed before the role can be deleted. Enumerate
  # them so this works for any role regardless of how it was provisioned.
  while IFS= read -r p; do
    [[ -z "$p" ]] && continue
    aws iam delete-role-policy --role-name "$ROLE_NAME" --policy-name "$p"
    ok "Deleted inline policy: $p"
  done < <(aws iam list-role-policies --role-name "$ROLE_NAME" --query 'PolicyNames[]' --output text | tr '\t' '\n')
  aws iam delete-role --role-name "$ROLE_NAME"
  ok "Deleted role: $ROLE_NAME"
  info "The account-shared OIDC provider ($OIDC_HOST) was left in place."
  exit 0
fi

# ── create requirements ────────────────────────────────────────────────────────
[[ -n "$GITHUB_OWNER" ]] || { err "--owner is required (unless --delete)."; exit 1; }
[[ -n "$GITHUB_REPO"  ]] || { err "--repo is required (unless --delete)."; exit 1; }

# Refuse to create a trust that is not pinned to at least one principal claim
# beyond `aud` — a repo with no env/sub/workflow pin would be far too broad.
if [[ -n "$GITHUB_ENV" ]]; then
  SUBS+=("repo:${GITHUB_OWNER}/${GITHUB_REPO}:environment:${GITHUB_ENV}")
fi
if [[ ${#SUBS[@]} -eq 0 && ${#WORKFLOWS[@]} -eq 0 ]]; then
  err "Refusing to create an under-pinned trust: pass at least one of --env, --sub, or --workflow."
  exit 1
fi

# ── GitHub OIDC identity provider ─────────────────────────────────────────────
step "GitHub OIDC identity provider"
OIDC_ARN=$(aws iam list-open-id-connect-providers \
  --query "OpenIDConnectProviderList[?contains(Arn,\`$OIDC_HOST\`)].Arn" \
  --output text)
if [[ -n "$OIDC_ARN" ]]; then
  ok "Already exists: $OIDC_ARN"
else
  info "Not found — creating..."
  aws iam create-open-id-connect-provider \
    --url "https://$OIDC_HOST" \
    --client-id-list sts.amazonaws.com \
    --thumbprint-list \
      6938fd4d98bab03faadb97b34396831e3780aea1 \
      1c58a3a8518e8759bf075b76b750d4f2df264fcd \
    --query 'OpenIDConnectProviderArn' --output text >/dev/null
  ok "OIDC IdP created"
fi

# ── trust policy ──────────────────────────────────────────────────────────────
# aud is always pinned; sub and job_workflow_ref keys are included only when the
# caller supplied values for them.
STRINGLIKE=""
if [[ ${#SUBS[@]} -gt 0 ]]; then
  STRINGLIKE+="\"${OIDC_HOST}:sub\": $(json_string_array "${SUBS[@]}")"
fi
if [[ ${#WORKFLOWS[@]} -gt 0 ]]; then
  [[ -n "$STRINGLIKE" ]] && STRINGLIKE+=","
  STRINGLIKE+="\"${OIDC_HOST}:job_workflow_ref\": $(json_string_array "${WORKFLOWS[@]}")"
fi

TRUST_POLICY=$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:${PARTITION}:iam::${ACCOUNT_ID}:oidc-provider/${OIDC_HOST}"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "${OIDC_HOST}:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          ${STRINGLIKE}
        }
      }
    }
  ]
}
JSON
)

# ── create / update role ──────────────────────────────────────────────────────
step "Role $ROLE_NAME"
if aws iam get-role --role-name "$ROLE_NAME" &>/dev/null; then
  info "Already exists — updating trust policy..."
  aws iam update-assume-role-policy --role-name "$ROLE_NAME" --policy-document "$TRUST_POLICY"
  ok "Trust policy updated"
else
  info "Creating role..."
  aws iam create-role \
    --role-name "$ROLE_NAME" \
    --description "$DESCRIPTION" \
    --max-session-duration "$MAX_SESSION" \
    --assume-role-policy-document "$TRUST_POLICY" \
    --query 'Role.Arn' --output text >/dev/null
  ok "Role created"
fi

# ── inline permission policies ────────────────────────────────────────────────
if [[ ${#POLICY_NAMES[@]} -gt 0 ]]; then
  step "Attaching inline policies"
  for i in "${!POLICY_NAMES[@]}"; do
    name="${POLICY_NAMES[$i]}"
    path="${POLICY_PATHS[$i]}"
    [[ -f "$path" ]] || { err "Policy file not found: $path"; exit 1; }
    # Substitute the three tokens. Account/region/partition contain no '|'.
    doc=$(sed -e "s|__ACCOUNT_ID__|$ACCOUNT_ID|g" \
              -e "s|__REGION__|$REGION|g" \
              -e "s|__PARTITION__|$PARTITION|g" "$path")
    aws iam put-role-policy --role-name "$ROLE_NAME" --policy-name "$name" --policy-document "$doc"
    ok "Policy attached: $name  (from ${path##*/})"
  done
fi

# ── done ──────────────────────────────────────────────────────────────────────
echo ""
bold "Deployer role ready."
echo ""
echo "  Role ARN: $ROLE_ARN"
echo ""
echo "  Delete it later with:"
echo "    .github/scripts/aws/lib/create-deployer-role.sh --role-name $ROLE_NAME --delete"
