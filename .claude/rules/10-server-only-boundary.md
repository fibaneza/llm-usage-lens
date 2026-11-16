# Rule 10 — Server-only data boundary

DynamoDB and the AWS SDK are accessed **only** from server code. AWS
credentials must never reach the browser.

## Where things live

| Concern | Location | Notes |
|---|---|---|
| Data access functions | `apps/dashboard/lib/data/**` | Must `import "server-only"` at the top |
| DynamoDB client | `apps/dashboard/lib/dynamodb.ts` | Server only |
| LiteLLM gateway (from LiteLLM unit L1) | `apps/dashboard/lib/litellm/**` | Must `import "server-only"`; the only code that calls LiteLLM — one typed function per allowlisted operation (LiteLLM spec — *Allowlist*) |
| Route Handlers (the only HTTP backend) | `apps/dashboard/app/api/**` | Check the Auth.js session (and the `internal-admin` role on account writes; legacy `Admin` is an alias outside `APP_ENV=prod`), validate input with Zod, query DynamoDB, return the standard shape |
| Table setup + seeds | repo-root `scripts/` | Run via `pnpm db:create-table` / `pnpm db:seed` (`:empty` / `:large` / `:ranking`) |
| Shared schemas + model normalization (+ pure, dependency-free utilities used by ≥2 workspaces) | `packages/shared` (`@llm-usage-lens/shared`) | Imported by both `apps/dashboard` and `apps/collector` |

## Rules

1. **Client Components never import `apps/dashboard/lib/data/**` or
   `@aws-sdk/*`.** They receive data as props from Server Components or fetch
   from same-origin Route Handlers.
2. **Every data-access file starts with `import "server-only";`** — and so
   does every file under `apps/dashboard/lib/litellm/**`. Client Components
   never import `lib/litellm/**`, and the browser never calls LiteLLM; the
   LiteLLM service key is read only there (Rule 50.6).
3. **Route Handlers are the only HTTP-reachable backend.** They must:
   - Check the Auth.js session and return `401` if unauthenticated. The
     one exception is `GET /api/health` (no session, no data; Platform spec).
   - From Phase 4R, call the policy module (`resolveScope`/`can` in
     `lib/auth/`) after the session check: reads return only in-scope rows,
     an out-of-scope detail returns the same `404` body as a missing one,
     and each write route checks its own permission (Access Control spec —
     *Permission matrix*) and returns `403` before input parsing. Every
     `/api/*` Route Handler response sets `Cache-Control: private, no-store`.
   - Every write Route Handler (`POST`/`PUT`/`PATCH`/`DELETE`) under
     `app/api/`, except Auth.js's `auth/[...nextauth]` handler — today
     `POST /api/accounts` and `PATCH`/`DELETE /api/accounts/[id]` — returns
     `403` `FORBIDDEN` when the session lacks the `internal-admin` role (legacy
     `Admin` alias outside `APP_ENV=prod`), before input parsing
     (`withRoute(..., { requireAdmin: true })`; enforced by
     `app/api/write-routes.integration.test.ts`). Exception (user,
     2026-11-16; LiteLLM spec LD24): `PUT /api/litellm/toggles` and the
     team-links writes also accept `internal-org-admin`; the LiteLLM
     connection writes stay `internal-admin` only.
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
