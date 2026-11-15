#!/usr/bin/env bash
# Create or update the POC's CloudFormation stack (poc/cloudformation.yml)
# with the AWS CLI. Run on the developer machine. It provisions the
# infrastructure only: it never builds, pushes, pulls or starts the
# application. See poc/README.md - Deploy infrastructure.
#
# Values come from, in order of precedence: command-line options, then the
# configuration file (poc/stack.env, gitignored; template
# poc/stack.env.example), then the environment (AWS_PROFILE, AWS_REGION) and
# the template defaults.

set -euo pipefail

readonly DEFAULT_STACK_NAME="llm-usage-lens-poc"

usage() {
  cat <<'EOF'
Usage: poc/scripts/deploy-stack.sh [options]

Configuration file:
  --config <path>                KEY=VALUE file (default: poc/stack.env when it exists;
                                 copy poc/stack.env.example). An option given on the
                                 command line overrides the same value in the file.

Required on the first deploy, from the file or the command line (an update
reuses the previous values):
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

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
poc_dir="$(cd "$script_dir/.." && pwd)"
readonly DEFAULT_CONFIG="$poc_dir/stack.env"

profile=""
region=""
stack_name=""
config_file=""
validate="yes"
overrides=()

# Set a template parameter, replacing an earlier value for the same key, so
# the last caller wins (the command line is applied after the file).
set_param() {
  local key="$1" value="$2" kept=() entry
  for entry in ${overrides[@]+"${overrides[@]}"}; do
    [[ "$entry" == "$key="* ]] || kept+=("$entry")
  done
  overrides=(${kept[@]+"${kept[@]}"} "$key=$value")
}

# Read KEY=VALUE lines. The file is parsed, never sourced, so it cannot run
# commands. Blank values are ignored (the default applies).
load_config() {
  local file="$1" line key value number=0
  while IFS= read -r line || [[ -n "$line" ]]; do
    number=$((number + 1))
    line="${line#"${line%%[![:space:]]*}"}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    [[ "$line" == *=* ]] || die "$file:$number: expected KEY=VALUE"
    key="${line%%=*}"
    value="${line#*=}"
    key="${key%"${key##*[![:space:]]}"}"
    [[ "$key" =~ ^[A-Za-z][A-Za-z0-9_]*$ ]] || die "$file:$number: invalid key"
    # Drop a trailing comment, surrounding spaces and one pair of quotes.
    value="${value%%[[:space:]]#*}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    if [[ "$value" == \"*\" || "$value" == \'*\' ]] && [[ ${#value} -ge 2 ]]; then
      value="${value:1:${#value}-2}"
    fi
    [[ -n "$value" ]] || continue
    [[ "$value" != *"<"* && "$value" != *">"* ]] ||
      die "$file:$number: $key still holds a <placeholder>; set it or leave it empty"
    case "$key" in
      AWS_PROFILE) profile="$value" ;;
      AWS_REGION) region="$value" ;;
      STACK_NAME) stack_name="$value" ;;
      *) set_param "$key" "$value" ;;
    esac
  done <"$file"
}

# Command-line values are collected first and applied after the file.
cli_profile=""
cli_region=""
cli_stack_name=""
cli_params=()

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
    --config) config_file="$2" ;;
    --profile) cli_profile="$2" ;;
    --region) cli_region="$2" ;;
    --stack-name) cli_stack_name="$2" ;;
    --vpc-id) cli_params+=("VpcId=$2") ;;
    --subnet-id) cli_params+=("SubnetId=$2") ;;
    --instance-name) cli_params+=("InstanceName=$2") ;;
    --instance-type) cli_params+=("InstanceType=$2") ;;
    --architecture) cli_params+=("InstanceArchitecture=$2") ;;
    --root-volume-size) cli_params+=("RootVolumeSizeGiB=$2") ;;
    --ecr-repository-name) cli_params+=("EcrRepositoryName=$2") ;;
    --app-port) cli_params+=("AppPort=$2") ;;
    --allowed-inbound-cidr) cli_params+=("AllowedInboundCidr=$2") ;;
    --alb-arn) cli_params+=("ExistingAlbArn=$2") ;;
    --alb-listener-port) cli_params+=("AlbListenerPort=$2") ;;
    --alb-certificate-arn) cli_params+=("AlbCertificateArn=$2") ;;
    --alb-allowed-inbound-cidr) cli_params+=("AlbAllowedInboundCidr=$2") ;;
    --parameter)
      [[ "$2" == *=* ]] || die "--parameter needs Key=Value"
      cli_params+=("$2")
      ;;
    *)
      usage >&2
      die "unknown option: $1"
      ;;
  esac
  shift 2
done

if [[ -n "$config_file" ]]; then
  [[ -f "$config_file" ]] || die "configuration file not found: $config_file"
elif [[ -f "$DEFAULT_CONFIG" ]]; then
  config_file="$DEFAULT_CONFIG"
fi
if [[ -n "$config_file" ]]; then
  log "Reading configuration from $config_file"
  load_config "$config_file"
fi

for entry in ${cli_params[@]+"${cli_params[@]}"}; do
  set_param "${entry%%=*}" "${entry#*=}"
done
profile="${cli_profile:-${profile:-${AWS_PROFILE:-}}}"
region="${cli_region:-${region:-${AWS_REGION:-${AWS_DEFAULT_REGION:-}}}}"
stack_name="${cli_stack_name:-${stack_name:-$DEFAULT_STACK_NAME}}"

aws_cli() {
  local args=()
  [[ -n "$profile" ]] && args+=(--profile "$profile")
  [[ -n "$region" ]] && args+=(--region "$region")
  # The ${args[@]+...} form keeps an empty array safe under `set -u` on the
  # bash 3.2 that macOS ships.
  aws ${args[@]+"${args[@]}"} "$@"
}

template="$poc_dir/cloudformation.yml"
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
    die "the first deploy needs VpcId and SubnetId (poc/stack.env, or --vpc-id and --subnet-id)"
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
