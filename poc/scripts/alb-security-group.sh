#!/usr/bin/env bash
# Attach the POC's own security group to the existing Application Load
# Balancer, or detach it again. CloudFormation cannot do this for a load
# balancer the stack does not own. Run on the developer machine.
#
# Only the POC's group (stack output AlbSecurityGroupId) is ever added or
# removed. The load balancer's other security groups are read first and kept
# exactly as they are; nothing else on the load balancer is changed and
# nothing is deleted. See poc/README.md - Publish through an existing load
# balancer.

set -euo pipefail

readonly DEFAULT_STACK_NAME="llm-usage-lens-poc"
# Limit of security groups per Application Load Balancer.
readonly MAX_GROUPS=5

usage() {
  cat <<'EOF'
Usage: poc/scripts/alb-security-group.sh <attach|detach|status> [options]

  attach   Add the POC security group to the load balancer's existing groups
  detach   Remove only the POC security group (run before deleting the stack)
  status   Show the load balancer's groups and whether the POC group is attached

Options:
  --profile <name>      AWS CLI profile (default: AWS_PROFILE or the default chain)
  --region <region>     AWS region (default: AWS_REGION, AWS_DEFAULT_REGION or the profile's region)
  --stack-name <name>   CloudFormation stack name (default: llm-usage-lens-poc)
  -h, --help            Show this help
EOF
}

log() { printf '==> %s\n' "$*"; }
die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

action="${1:-}"
case "$action" in
  attach | detach | status) shift ;;
  -h | --help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    die "first argument must be attach, detach or status"
    ;;
esac

profile="${AWS_PROFILE:-}"
region="${AWS_REGION:-${AWS_DEFAULT_REGION:-}}"
stack_name="$DEFAULT_STACK_NAME"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile | --region | --stack-name)
      [[ $# -ge 2 ]] || die "$1 needs a value"
      case "$1" in
        --profile) profile="$2" ;;
        --region) region="$2" ;;
        --stack-name) stack_name="$2" ;;
      esac
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      die "unknown option: $1"
      ;;
  esac
done

aws_cli() {
  local args=()
  [[ -n "$profile" ]] && args+=(--profile "$profile")
  [[ -n "$region" ]] && args+=(--region "$region")
  # The ${args[@]+...} form keeps an empty array safe under `set -u` on the
  # bash 3.2 that macOS ships.
  aws ${args[@]+"${args[@]}"} "$@"
}

stack_output() {
  aws_cli cloudformation describe-stacks --stack-name "$stack_name" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue | [0]" --output text
}

command -v aws >/dev/null 2>&1 || die "the AWS CLI is not installed or not on PATH"

alb_arn="$(stack_output AlbArn)" || die "stack $stack_name not found"
poc_group="$(stack_output AlbSecurityGroupId)"
[[ -n "$alb_arn" && "$alb_arn" != "None" && -n "$poc_group" && "$poc_group" != "None" ]] ||
  die "stack $stack_name was deployed without ExistingAlbArn: there is nothing to attach"

current_text="$(aws_cli elbv2 describe-load-balancers --load-balancer-arns "$alb_arn" \
  --query 'LoadBalancers[0].SecurityGroups' --output text)" ||
  die "cannot read the load balancer $alb_arn"
[[ "$current_text" != "None" ]] || current_text=""
current=()
# shellcheck disable=SC2206 # group IDs contain no spaces or globs
[[ -n "$current_text" ]] && current=($current_text)

attached="no"
others=()
for group in ${current[@]+"${current[@]}"}; do
  if [[ "$group" == "$poc_group" ]]; then
    attached="yes"
  else
    others+=("$group")
  fi
done

log "Load balancer: $alb_arn"
log "Current security groups: ${current[*]:-none}"
log "POC security group: $poc_group (attached: $attached)"

case "$action" in
  status) ;;
  attach)
    if [[ "$attached" == "yes" ]]; then
      log "Already attached; nothing to do"
      exit 0
    fi
    [[ ${#current[@]} -lt $MAX_GROUPS ]] ||
      die "the load balancer already has $MAX_GROUPS security groups (the limit); none was changed"
    log "Attaching $poc_group in addition to the existing groups"
    aws_cli elbv2 set-security-groups --load-balancer-arn "$alb_arn" \
      --security-groups ${current[@]+"${current[@]}"} "$poc_group" \
      --query 'SecurityGroupIds' --output text
    log "Done"
    ;;
  detach)
    if [[ "$attached" == "no" ]]; then
      log "Not attached; nothing to do"
      exit 0
    fi
    [[ ${#others[@]} -ge 1 ]] ||
      die "the POC group is the load balancer's only security group; attach another group to it first"
    log "Detaching $poc_group; keeping: ${others[*]}"
    aws_cli elbv2 set-security-groups --load-balancer-arn "$alb_arn" \
      --security-groups "${others[@]}" \
      --query 'SecurityGroupIds' --output text
    log "Done"
    ;;
esac
