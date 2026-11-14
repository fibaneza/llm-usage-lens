#!/usr/bin/env bash
# Create the dashboard's table in the POC's DynamoDB Local. Run on the EC2
# instance after `docker compose up -d`. Idempotent. Same definition as
# scripts/create-table.ts (docs/specs/2026-05-15-data-model.md - Table
# Definition).

set -euo pipefail

readonly ENDPOINT="http://127.0.0.1:8000"

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
env_file="${1:-$script_dir/../.env}"

# Read only the two values needed; the .env file is never sourced.
env_value() {
  [[ -f "$env_file" ]] || return 0
  sed -n "s/^$1=//p" "$env_file" | tail -n 1 | sed "s/[[:space:]]*#.*$//; s/^['\"]//; s/['\"]$//"
}

table_name="$(env_value DYNAMODB_TABLE_NAME)"
table_name="${table_name:-bedrock-usage}"
region="$(env_value AWS_REGION)"
region="${region:-ap-southeast-2}"

command -v aws >/dev/null 2>&1 || die "the AWS CLI is not installed"

# DynamoDB Local needs some credentials but checks none. These dummy values
# apply to this script's calls only and are not AWS keys; the endpoint is fixed
# to the local container, so the script cannot reach real DynamoDB.
ddb_local() {
  env -u AWS_SESSION_TOKEN -u AWS_PROFILE AWS_ACCESS_KEY_ID=local AWS_SECRET_ACCESS_KEY=local \
    aws dynamodb "$@" --endpoint-url "$ENDPOINT" --region "$region" --no-cli-pager
}

ddb_local list-tables --output text >/dev/null 2>&1 ||
  die "DynamoDB Local is not answering on $ENDPOINT (is the Compose stack up?)"

if ddb_local describe-table --table-name "$table_name" >/dev/null 2>&1; then
  printf 'Table %s already exists at %s\n' "$table_name" "$ENDPOINT"
  exit 0
fi

ddb_local create-table \
  --table-name "$table_name" \
  --billing-mode PAY_PER_REQUEST \
  --attribute-definitions \
    AttributeName=PK,AttributeType=S \
    AttributeName=SK,AttributeType=S \
    AttributeName=gsi1pk,AttributeType=S \
    AttributeName=gsi1sk,AttributeType=S \
  --key-schema \
    AttributeName=PK,KeyType=HASH \
    AttributeName=SK,KeyType=RANGE \
  --global-secondary-indexes \
    'IndexName=GSI1,KeySchema=[{AttributeName=gsi1pk,KeyType=HASH},{AttributeName=gsi1sk,KeyType=RANGE}],Projection={ProjectionType=ALL}' \
  >/dev/null

ddb_local wait table-exists --table-name "$table_name"
printf 'Table %s created at %s\n' "$table_name" "$ENDPOINT"
