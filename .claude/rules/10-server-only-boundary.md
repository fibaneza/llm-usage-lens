# Rule 10 — Server-only data boundary

DynamoDB and the AWS SDK are accessed **only** from server code. AWS
credentials must never reach the browser.

## Where things live

| Concern | Location | Notes |
|---|---|---|
| Data access functions | `apps/dashboard/lib/data/**` | Must `import "server-only"` at the top |
| DynamoDB client | `apps/dashboard/lib/dynamodb.ts` | Server only |
| Route Handlers (the only HTTP backend) | `apps/dashboard/app/api/**` | Check the Auth.js session (and the `Admin` role on account writes), validate input with Zod, query DynamoDB, return the standard shape |
| Table setup + seeds | repo-root `scripts/` | Run via `pnpm db:create-table` / `pnpm db:seed` (`:empty` / `:large` / `:ranking`) |
| Shared schemas + model normalization (+ pure, dependency-free utilities used by ≥2 workspaces) | `packages/shared` (`@bedrock-usage/shared`) | Imported by both `apps/dashboard` and `apps/collector` |

## Rules

1. **Client Components never import `apps/dashboard/lib/data/**` or
   `@aws-sdk/*`.** They receive data as props from Server Components or fetch
   from same-origin Route Handlers.
2. **Every data-access file starts with `import "server-only";`.**
3. **Route Handlers are the only HTTP-reachable backend.** They must:
   - Check the Auth.js session and return `401` if unauthenticated.
   - On the account write routes (`POST /api/accounts`, `PATCH`/`DELETE
     /api/accounts/[id]`), return `403` `FORBIDDEN` when the session lacks the
     `Admin` role — before input parsing.
   - Validate query/body with Zod (`400` on failure).
   - Return `{ data: T }` on success, `{ error: { code, message } }` on failure.
   - Use the `DateRangeQuerySchema` 90-day cap on custom ranges.
4. **Response shape is mandatory and Zod-validated on both ends.** Do not
   invent ad-hoc shapes (no bare arrays, no `{ result: ... }`, no top-level
   error strings).
5. **No AWS SDK imports outside `apps/dashboard/app/api/**`,
   `apps/dashboard/lib/data/**`, `apps/dashboard/lib/dynamodb.ts`,
   `apps/collector/**`, or repo-root `scripts/**`** (DynamoDB-Local-only dev
   tooling that refuses non-local endpoints and is never imported by app
   code). In particular, no AWS SDK import in any `"use client"` module or in a Server Component's client subtree. If you
   find one, treat it as a security bug.

See `docs/specs/2026-05-15-system-architecture.md`
("Authentication & Access") and `docs/specs/2026-05-15-data-model.md`
("API Routes").
