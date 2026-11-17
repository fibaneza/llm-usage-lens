#!/usr/bin/env bash
# Build the dashboard image locally and push it to the POC's ECR repository
# with the single tag "latest". Run on the developer machine, never on EC2.
# See poc/README.md - Build and push the image.

set -euo pipefail

readonly IMAGE_TAG="latest"
readonly DEFAULT_STACK_NAME="llm-usage-lens-poc"
readonly DEFAULT_BASE_PATH="/llm-lens"

usage() {
  cat <<'EOF'
Usage: poc/scripts/build-and-push.sh [options]

Options:
  --profile <name>         AWS CLI profile (default: AWS_PROFILE or the default chain)
  --region <region>        AWS region (default: AWS_REGION, AWS_DEFAULT_REGION or the profile's region)
  --stack-name <name>      CloudFormation stack name (default: llm-usage-lens-poc)
  --platform <platform>    linux/arm64 or linux/amd64 (default: the stack's ImagePlatform output)
  --repository-uri <uri>   ECR repository URI without a tag; skips the stack lookup
  --base-path <prefix>     URL prefix compiled into the image (default: /llm-lens);
                           lower-case /segments, or "" to serve from /
  -h, --help               Show this help

The image is always tagged and pushed as <repository-uri>:latest. The base path
is compiled into the image: build one image per prefix.
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
base_path="$DEFAULT_BASE_PATH"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile | --region | --stack-name | --platform | --repository-uri | --base-path)
      [[ $# -ge 2 ]] || die "$1 needs a value"
      case "$1" in
        --profile) profile="$2" ;;
        --region) region="$2" ;;
        --stack-name) stack_name="$2" ;;
        --platform) platform="$2" ;;
        --repository-uri) repository_uri="$2" ;;
        --base-path) base_path="$2" ;;
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

# Same format as NEXT_PUBLIC_BASE_PATH (Platform spec - Base path, BP-D2).
[[ -z "$base_path" || "$base_path" =~ ^(/[a-z0-9-]+)+$ ]] ||
  die "--base-path must be empty or lower-case /segments such as /llm-lens, with no trailing slash"

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

# The Dockerfile's build context is the repository root
# (apps/dashboard/Dockerfile: "Build from the repo root").
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
dockerfile="$repo_root/apps/dashboard/Dockerfile"

log "Checking tools"
for tool in aws docker; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool is not installed or not on PATH"
done
docker buildx version >/dev/null 2>&1 || die "Docker Buildx is not available"
docker info >/dev/null 2>&1 || die "the Docker daemon is not running"
[[ -f "$dockerfile" ]] || die "Dockerfile not found: $dockerfile"

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

image="$repository_uri:$IMAGE_TAG"

log "Logging Docker in to $registry"
aws_cli ecr get-login-password |
  docker login --username AWS --password-stdin "$registry" >/dev/null ||
  die "docker login to ECR failed"

log "Building $image for $platform (base path: ${base_path:-none})"
# --provenance=false keeps the push to one image manifest, so "latest" does
# not leave attestation manifests behind as untagged images.
docker buildx build \
  --platform "$platform" \
  --provenance=false \
  --build-arg "NEXT_PUBLIC_BASE_PATH=$base_path" \
  --file "$dockerfile" \
  --tag "$image" \
  --load \
  "$repo_root"

log "Pushing $image"
docker push "$image"

log "Done: $image ($platform)"
log "Next, on the EC2 instance: docker compose pull && docker compose up -d"
