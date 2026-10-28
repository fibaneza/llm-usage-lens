# Rule 50 — Security & secrets

## Two credential concerns — never conflate them

| Concern | Mechanism | Where it lives |
|---|---|---|
| Dashboard login (who the user is) | Auth.js v5 + Microsoft Entra ID | `apps/dashboard/auth.ts` |
| AWS access (how the server reads DynamoDB / collector reads AWS) | AWS SDK default credential chain | Process environment (SSO + `AWS_PROFILE`) |

## Rules

1. **Never use static `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`.** Real AWS
   access goes through `aws sso login` + `AWS_PROFILE`. DynamoDB Local needs
   no real credentials; the dummy `local`/`local` pair is set only when
   `isLocalEndpoint` is true (`apps/dashboard/lib/dynamodb.ts`,
   `scripts/lib/dynamodb-local.ts`) — every other endpoint uses the default
   chain.
2. **Env vars are validated at build time** by `@t3-oss/env-nextjs` with Zod.
   Add new env vars to the schema, not to ad-hoc `process.env` reads.
   Exception: code outside the Next.js app — repo-root `scripts/**`, test
   helpers, and tool config (`vitest.config.ts`, `playwright.config.ts`) —
   may read `process.env` directly.
3. **Auth.js is the identity-provider abstraction.** Switching providers is a
   change to `apps/dashboard/auth.ts` only — keep provider-specific code out
   of routes and components.
4. **All Route Handlers must check the Auth.js session** and return `401`
   when unauthenticated, before any DynamoDB call.
5. **Never bypass git hooks.** Do not run `git commit --no-verify` or
   `git push --no-verify`. Gitleaks runs in pre-commit and must pass.
6. **Never log or echo secrets.** Don't print env values, OAuth client
   secrets, `AUTH_SECRET`, or AWS keys to the terminal or to telemetry
   (OpenTelemetry spans, logs, or attributes).
7. **The collector targets `us-east-1` only.** Multi-region is a documented
   future enhancement; do not silently broaden the scope.
8. **Sanitize input at the system boundary.** Route Handlers validate every
   query and body with Zod; data-access functions trust their typed inputs.
9. **Never commit a real AWS account ID.** Tracked files (scripts, docs,
   `*.example`, workflows) use the `000000000000` placeholder. Real account IDs
   live only in gitignored config — `tools/bedrock-simulator/.bootstrap.env`
   and `samconfig.toml` — never in `bootstrap.sh` defaults, docs, or hook
   scripts (match the pattern, not the value). Enforced by the `aws-account-id`
   rule in the repo-root `.gitleaks.toml` and the simulator `pre-push` hook.

See `docs/guides/auth-setup.md` and the
Authentication section of
`docs/specs/2026-05-15-system-architecture.md`.
