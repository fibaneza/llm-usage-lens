---
description: Scaffold a new Route Handler that follows project conventions
argument-hint: <HTTP path, e.g. /api/teams/[id]>
---

# /new-route

Create a Next.js Route Handler at `$ARGUMENTS` following the conventions in
`.claude/rules/10-server-only-boundary.md` and
`docs/specs/2026-05-15-data-model.md` ("API Routes").

The handler **must**:

1. Live in `apps/dashboard/app/api/...route.ts` matching `$ARGUMENTS`.
2. Start with `import "server-only";`.
3. Check the Auth.js session via `auth()` and return `401`
   `{ error: { code: "UNAUTHORIZED", message: "..." } }` if missing. A
   write route (`POST`/`PUT`/`PATCH`/`DELETE`) then returns `403` `FORBIDDEN` when the session lacks
   the `Admin` role, before parsing input — wrap it in
   `withRoute(handler, { requireAdmin: true })` (`lib/api/respond.ts`), which
   enforces that order; never hand-write the check.
4. Parse query params with a Zod schema from `@bedrock-usage/shared`
   (re-use existing `DateRangeQuerySchema` / `RankingQuerySchema` /
   `TeamsQuerySchema` when applicable). Return `400` on parse failure.
5. Enforce the **90-day cap** on custom date ranges.
6. Call a function from `apps/dashboard/lib/data/**` — never call DynamoDB
   directly from the route.
7. Return `{ data: T }` on success; map known errors to
   `{ error: { code, message } }` with the appropriate HTTP status; let
   unknown errors bubble to Sentry as `500`.
8. Set `export const revalidate = 3600;` unless the spec requires otherwise.

Steps:

1. Confirm the route is listed in the Data Model spec "API Routes" table. If
   not, ask the user — do not invent endpoints.
2. Generate the route file and the matching data-access function stub if it
   doesn't exist (use `/new-data-access` conventions).
3. Add a Vitest test stub that asserts the response shape and a `401` path
   (plus a `403` path for a write route).
