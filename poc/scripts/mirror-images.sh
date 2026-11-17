#!/usr/bin/env bash
# Mirror the third-party images the POC's Compose stack uses into the POC's
# own ECR repository, so the EC2 host pulls everything from ECR and never
# needs Docker Hub. Run on the developer machine, never on EC2.
# See poc/README.md - Mirror the third-party images.
#
# Each image lands in the SAME repository as the app image, under the tag
# "<name>-<source tag>":
#   amazon/dynamodb-local:<tag>     -> <repository-uri>:dynamodb-local-<tag>
#   aaronshaf/dynamodb-admin:<tag>  -> <repository-uri>:dynamodb-admin-<tag>
#   amazon/aws-cli:<tag>            -> <repository-uri>:aws-cli-<tag>
#
# The copy is registry to registry (docker buildx imagetools), nothing is
# pulled into the local Docker. Only the manifest of the target platform is
# copied, as a single image: the repository's lifecycle rule expires untagged
# images, and the per-platform children of a multi-platform index would be
# untagged.

set -euo pipefail

readonly DEFAULT_STACK_NAME="llm-usage-lens-poc"

usage() {
  cat <<'EOF'
Usage: poc/scripts/mirror-images.sh [options]

Options:
  --profile <name>              AWS CLI profile (default: AWS_PROFILE or the default chain)
  --region <region>             AWS region (default: AWS_REGION, AWS_DEFAULT_REGION or the profile's region)
  --stack-name <name>           CloudFormation stack name (default: llm-usage-lens-poc)
  --platform <platform>         linux/arm64 or linux/amd64 (default: the stack's ImagePlatform output)
  --repository-uri <uri>        ECR repository URI without a tag; skips the stack lookup
  --dynamodb-local-tag <tag>    amazon/dynamodb-local tag (default: latest)
  --dynamodb-admin-tag <tag>    aaronshaf/dynamodb-admin tag (default: latest)
  --aws-cli-tag <tag>           amazon/aws-cli tag (default: latest)
  -h, --help                    Show this help

Use the same tags as DYNAMODB_LOCAL_TAG, DYNAMODB_ADMIN_TAG and AWS_CLI_TAG
in the instance's .env. Re-run it to refresh a mirrored tag.
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
platform=""
repository_uri=""
dynamodb_local_tag="latest"
dynamodb_admin_tag="latest"
aws_cli_tag="latest"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h | --help)
      usage
      exit 0
      ;;
    --profile | --region | --stack-name | --platform | --repository-uri | \
      --dynamodb-local-tag | --dynamodb-admin-tag | --aws-cli-tag)
      [[ $# -ge 2 ]] || die "$1 needs a value"
      case "$1" in
        --profile) profile="$2" ;;
        --region) region="$2" ;;
        --stack-name) stack_name="$2" ;;
        --platform) platform="$2" ;;
        --repository-uri) repository_uri="$2" ;;
        --dynamodb-local-tag) dynamodb_local_tag="$2" ;;
        --dynamodb-admin-tag) dynamodb_admin_tag="$2" ;;
        --aws-cli-tag) aws_cli_tag="$2" ;;
      esac
      shift 2
      ;;
    *)
      usage >&2
      die "unknown option: $1"
      ;;
  esac
done

for tag in "$dynamodb_local_tag" "$dynamodb_admin_tag" "$aws_cli_tag"; do
  [[ "$tag" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,100}$ ]] || die "invalid image tag: $tag"
done

aws_cli() {
  local args=()
  [[ -n "$profile" ]] && args+=(--profile "$profile")
  [[ -n "$region" ]] && args+=(--region "$region")
  # ${args[@]+...} keeps an empty array safe under `set -u` on macOS bash 3.2.
  aws ${args[@]+"${args[@]}"} "$@"
}

stack_output() {
  aws_cli cloudformation describe-stacks --stack-name "$stack_name" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue | [0]" --output text
}

log "Checking tools"
for tool in aws docker; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool is not installed or not on PATH"
done
docker buildx version >/dev/null 2>&1 || die "Docker Buildx is not available"

if [[ -z "$region" ]]; then
  region="$(aws_cli configure get region || true)"
fi
[[ -n "$region" ]] || die "no AWS region: pass --region or set AWS_REGION"

log "Checking AWS credentials"
account_id="$(aws_cli sts get-caller-identity --query Account --output text)" ||
  die "AWS credentials are not valid (run: aws sso login${profile:+ --profile $profile})"

if [[ -z "$repository_uri" ]]; then
  log "Reading outputs of stack $stack_name ($region)"
  repository_uri="$(stack_output EcrRepositoryUri)" ||
    die "stack $stack_name not found in $region"
  [[ -n "$repository_uri" && "$repository_uri" != "None" ]] ||
    die "stack $stack_name has no EcrRepositoryUri output"
  if [[ -z "$platform" ]]; then
    platform="$(stack_output ImagePlatform)"
    [[ "$platform" != "None" ]] || platform=""
  fi
fi
[[ -n "$platform" ]] ||
  die "no target platform: pass --platform linux/arm64 or linux/amd64"
case "$platform" in
  linux/arm64 | linux/amd64) ;;
  *) die "unsupported platform: $platform (use linux/arm64 or linux/amd64)" ;;
esac
arch="${platform#linux/}"

registry="${repository_uri%%/*}"
repository_name="${repository_uri#*/}"
[[ "$repository_uri" == */* && "$registry" == *.dkr.ecr.*.amazonaws.com* ]] ||
  die "not an ECR repository URI: $repository_uri"
[[ "$registry" == "$account_id".* ]] ||
  die "the repository is not in the account of the current credentials"
[[ "$registry" == *".dkr.ecr.$region."* ]] ||
  die "the repository is not in region $region"

log "Checking ECR repository $repository_name"
aws_cli ecr describe-repositories --repository-names "$repository_name" \
  --query 'repositories[0].repositoryName' --output text >/dev/null ||
  die "ECR repository $repository_name not found in $region"

log "Logging Docker in to $registry"
aws_cli ecr get-login-password |
  docker login --username AWS --password-stdin "$registry" >/dev/null ||
  die "docker login to ECR failed"

# Digest of the source's manifest for the target platform. A multi-platform
# index yields the matching child; a single-platform image yields "" and is
# checked separately.
platform_digest() {
  docker buildx imagetools inspect "$1" --format \
    "{{range .Manifest.Manifests}}{{if and (eq .Platform.OS \"linux\") (eq .Platform.Architecture \"$arch\")}}{{.Digest}}{{\"\\n\"}}{{end}}{{end}}" |
    head -n 1
}

mirror() {
  local source="$1" target="$2" digest
  log "Resolving $source for $platform"
  digest="$(platform_digest "$source")" || die "cannot inspect $source"
  if [[ -z "$digest" ]]; then
    # Not an index: accept it only when it is already built for the target.
    local image_arch
    image_arch="$(docker buildx imagetools inspect "$source" --format '{{.Image.Architecture}}')" ||
      die "cannot inspect $source"
    [[ "$image_arch" == "$arch" ]] ||
      die "$source has no $platform image (found: ${image_arch:-unknown})"
    log "Copying $source -> $target"
    docker buildx imagetools create --tag "$target" "$source"
  else
    local repo="${source%:*}"
    log "Copying $repo@$digest -> $target"
    docker buildx imagetools create --tag "$target" "$repo@$digest"
  fi
}

mirror "amazon/dynamodb-local:$dynamodb_local_tag" "$repository_uri:dynamodb-local-$dynamodb_local_tag"
mirror "aaronshaf/dynamodb-admin:$dynamodb_admin_tag" "$repository_uri:dynamodb-admin-$dynamodb_admin_tag"
mirror "amazon/aws-cli:$aws_cli_tag" "$repository_uri:aws-cli-$aws_cli_tag"

log "Done. In the instance's .env:"
log "  DYNAMODB_LOCAL_TAG=$dynamodb_local_tag"
log "  DYNAMODB_ADMIN_TAG=$dynamodb_admin_tag"
log "  AWS_CLI_TAG=$aws_cli_tag"
