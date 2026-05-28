#!/usr/bin/env bash
# Single source of truth for the SENSITIVE file-path regex.
# Source this file; it exports SENSITIVE into the caller's environment.
#
# Paths that trigger the security audit (Rules 10 / 50):
#   - Auth.js entry points and the server-only DynamoDB boundary
#   - Route Handlers (apps/dashboard/app/api/)
#   - The AWS Lambda collector (Phase 6)
#   - Infrastructure and env/auth schemas
#   - Lockfiles and .env* files
#   - GitHub Actions workflows (changes to CI itself)
#
# Update here when the project layout shifts — both scope scripts source this.

SENSITIVE='^(apps/dashboard/(auth\.ts|middleware\.ts|app/api/|lib/data/|lib/dynamodb\.ts|lib/auth)|apps/collector/|infrastructure/|packages/shared/src/(env|auth)|.*\.env(\..+)?$|package\.json$|pnpm-lock\.yaml$|\.github/workflows/)'
export SENSITIVE
