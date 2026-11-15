#!/usr/bin/env bash
# Create or update the POC's CloudFormation stack (poc/cloudformation.yml)
# with the AWS CLI. Run on the developer machine. It provisions the
# infrastructure only: it never builds, pushes, pulls or starts the
# application. See poc/README.md - Deploy infrastructure.

set -euo pipefail

readonly DEFAULT_STACK_NAME="llm-usage-lens-poc"

usage() {
  cat <<'EOF'
Usage: poc/scripts/deploy-stack.sh --vpc-id <vpc-id> --subnet-id <subnet-id> [options]

Required on the first deploy (an update reuses the previous values):
  --vpc-id <id>                  Existing VPC
  --subnet-id <id>               Existing subnet in that VPC

AWS options:
  --profile <name>               AWS CLI profile (default: AWS_PROFILE or the default chain)
  --region <region>              AWS region (default: AWS_REGION, AWS_DEFAULT_REGION or the profile's region)
  --stack-name <name>            Stack name (default: llm-usage-lens-poc)

Template parameters (each defaults to the template's default, or to the
stack's current value on an update):
  --instance-name <name>         InstanceName
  --instance-type <type>         InstanceType (default t4g.small)
  --architecture <arch>          InstanceArchitecture: arm64 or x86_64
  --root-volume-size <GiB>       RootVolumeSizeGiB
  --ecr-repository-name <name>   EcrRepositoryName (default llm-usage-lens-poc)
  --app-port <port>              AppPort
  --allowed-inbound-cidr <cidr>  AllowedInboundCidr (direct access to the instance)
  --alb-arn <arn>                ExistingAlbArn (existing Application Load Balancer)
  --alb-listener-port <port>     AlbListenerPort
  --alb-certificate-arn <arn>    AlbCertificateArn (HTTPS listener)
  --alb-allowed-inbound-cidr <cidr>  AlbAllowedInboundCidr
  --parameter <Key=Value>        Any other template parameter; repeatable

Other:
  --skip-validate                Do not call validate-template first
  -h, --help                     Show this help
EOF
}

log() { printf '==> %s\n' "$*"; }
die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

profile="${AWS_PROFILE:-}"
region="${AWS_REGION:-${AWS_DEFAULT_REGION:-}}"
stack_name="$DEFAULT_STACK_NAME"
validate="yes"
overrides=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h | --help)
      usage
      exit 0
      ;;
    --skip-validate)
      validate="no"
      shift
      continue
      ;;
  esac
  [[ $# -ge 2 ]] || {
    usage >&2
    die "unknown option or missing value: $1"
  }
  case "$1" in
    --profile) profile="$2" ;;
    --region) region="$2" ;;
    --stack-name) stack_name="$2" ;;
    --vpc-id) overrides+=("VpcId=$2") ;;
    --subnet-id) overrides+=("SubnetId=$2") ;;
    --instance-name) overrides+=("InstanceName=$2") ;;
    --instance-type) overrides+=("InstanceType=$2") ;;
    --architecture) overrides+=("InstanceArchitecture=$2") ;;
    --root-volume-size) overrides+=("RootVolumeSizeGiB=$2") ;;
    --ecr-repository-name) overrides+=("EcrRepositoryName=$2") ;;
    --app-port) overrides+=("AppPort=$2") ;;
    --allowed-inbound-cidr) overrides+=("AllowedInboundCidr=$2") ;;
    --alb-arn) overrides+=("ExistingAlbArn=$2") ;;
    --alb-listener-port) overrides+=("AlbListenerPort=$2") ;;
    --alb-certificate-arn) overrides+=("AlbCertificateArn=$2") ;;
    --alb-allowed-inbound-cidr) overrides+=("AlbAllowedInboundCidr=$2") ;;
    --parameter)
      [[ "$2" == *=* ]] || die "--parameter needs Key=Value"
      overrides+=("$2")
      ;;
    *)
      usage >&2
      die "unknown option: $1"
      ;;
  esac
  shift 2
done

aws_cli() {
  local args=()
  [[ -n "$profile" ]] && args+=(--profile "$profile")
  [[ -n "$region" ]] && args+=(--region "$region")
  # The ${args[@]+...} form keeps an empty array safe under `set -u` on the
  # bash 3.2 that macOS ships.
  aws ${args[@]+"${args[@]}"} "$@"
}

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
template="$(cd "$script_dir/.." && pwd)/cloudformation.yml"
this_script="poc/scripts/$(basename "${BASH_SOURCE[0]}")"

command -v aws >/dev/null 2>&1 || die "the AWS CLI is not installed or not on PATH"
[[ -f "$template" ]] || die "template not found: $template"

if [[ -z "$region" ]]; then
  region="$(aws_cli configure get region || true)"
fi
[[ -n "$region" ]] || die "no AWS region: pass --region or set AWS_REGION"

log "Checking AWS credentials"
aws_cli sts get-caller-identity --query Account --output text >/dev/null ||
  die "AWS credentials are not valid (run: aws sso login${profile:+ --profile $profile})"

stack_exists="no"
if aws_cli cloudformation describe-stacks --stack-name "$stack_name" \
  --query 'Stacks[0].StackName' --output text >/dev/null 2>&1; then
  stack_exists="yes"
fi

if [[ "$stack_exists" == "no" ]]; then
  joined=" ${overrides[*]:-} "
  [[ "$joined" == *" VpcId="* && "$joined" == *" SubnetId="* ]] ||
    die "the first deploy needs --vpc-id and --subnet-id"
fi

if [[ "$validate" == "yes" ]]; then
  log "Validating $template"
  aws_cli cloudformation validate-template --template-body "file://$template" \
    --query 'Description' --output text >/dev/null ||
    die "the template did not validate (or you lack cloudformation:ValidateTemplate; use --skip-validate)"
fi

if [[ "$stack_exists" == "yes" ]]; then
  log "Updating stack $stack_name in $region"
else
  log "Creating stack $stack_name in $region"
fi

deploy_args=(
  --stack-name "$stack_name"
  --template-file "$template"
  --capabilities CAPABILITY_IAM
  --no-fail-on-empty-changeset
)
if [[ ${#overrides[@]} -gt 0 ]]; then
  deploy_args+=(--parameter-overrides "${overrides[@]}")
fi
aws_cli cloudformation deploy "${deploy_args[@]}"

log "Stack outputs"
aws_cli cloudformation describe-stacks --stack-name "$stack_name" \
  --query 'Stacks[0].Outputs[].[OutputKey,OutputValue]' --output table

alb_group="$(aws_cli cloudformation describe-stacks --stack-name "$stack_name" \
  --query "Stacks[0].Outputs[?OutputKey=='AlbSecurityGroupId'].OutputValue | [0]" --output text)"
common="--region $region --stack-name $stack_name${profile:+ --profile $profile}"

log "Next steps"
printf '  1. Build and push the image:  poc/scripts/build-and-push.sh %s\n' "$common"
if [[ -n "$alb_group" && "$alb_group" != "None" ]]; then
  printf '  2. Attach the new security group %s to the load balancer:\n' "$alb_group"
  printf '       poc/scripts/alb-security-group.sh attach %s\n' "$common"
  printf '     Before deleting the stack, detach it:\n'
  printf '       poc/scripts/alb-security-group.sh detach %s\n' "$common"
fi
printf '  Re-run %s to update the stack; unspecified parameters keep their current values.\n' "$this_script"
