# Rule 50 — Security & secrets

## Two credential concerns — never conflate them

| Concern | Mechanism | Where it lives |
|---|---|---|
| Dashboard login (who the user is) | Auth.js v5 + Microsoft Entra ID | `apps/dashboard/auth.ts` |
| AWS access (how the server reads DynamoDB / collector reads AWS) | AWS SDK default credential chain | Process environment (SSO + `AWS_PROFILE`) |

## Rules

1. **Never use static `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`.** Real AWS
   access goes through `aws sso login` + `AWS_PROFILE`. DynamoDB Local needs
   no real credentials.
2. **Env vars are validated at build time** by `@t3-oss/env-nextjs` with Zod.
   Add new env vars to the schema, not to ad-hoc `process.env` reads.
3. **Auth.js is the identity-provider abstraction.** Switching providers is a
   change to `apps/dashboard/auth.ts` only — keep provider-specific code out
   of routes and components.
4. **All Route Handlers must check the Auth.js session** and return `401`
   when unauthenticated, before any DynamoDB call.
5. **Never bypass git hooks.** Do not run `git commit --no-verify` or
   `git push --no-verify`. Gitleaks runs in pre-commit and must pass.
6. **Never log or echo secrets.** Don't print env values, OAuth client
   secrets, `AUTH_SECRET`, or AWS keys to the terminal or to Sentry.
7. **The collector targets `us-east-1` only.** Multi-region is a documented
   future enhancement; do not silently broaden the scope.
8. **Sanitize input at the system boundary.** Route Handlers validate every
   query and body with Zod; data-access functions trust their typed inputs.

See [docs/guides/auth-setup.md](../../docs/guides/auth-setup.md) and the
Authentication section of
[docs/specs/2026-05-15-system-architecture.md](../../docs/specs/2026-05-15-system-architecture.md).
