#!/usr/bin/env bash
# Print one shell command that recreates the POC's runtime files on the EC2
# instance. Run on the developer machine, then paste the printed command into
# the Session Manager shell. The bundle holds docker-compose.yml, .env.example
# and scripts/init-dynamodb.sh only: no secrets and no .env.
# See poc/README.md - Connect to EC2.

set -euo pipefail

readonly TARGET_DIR="/opt/llm-usage-lens-poc"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
poc_dir="$(cd "$script_dir/.." && pwd)"

for file in docker-compose.yml .env.example scripts/init-dynamodb.sh; do
  [[ -f "$poc_dir/$file" ]] || {
    printf 'ERROR: missing %s\n' "$poc_dir/$file" >&2
    exit 1
  }
done

# COPYFILE_DISABLE keeps macOS tar from adding ._* metadata files.
payload="$(
  COPYFILE_DISABLE=1 tar -czf - -C "$poc_dir" \
    docker-compose.yml .env.example scripts/init-dynamodb.sh | base64 | tr -d '\n'
)"

printf "sudo install -d -m 0750 %s && echo '%s' | base64 -d | sudo tar -xzf - --no-same-owner -C %s && sudo ls -la %s\n" \
  "$TARGET_DIR" "$payload" "$TARGET_DIR" "$TARGET_DIR"
