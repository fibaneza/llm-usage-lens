---
description: Scaffold a server-only data access function
argument-hint: <function name, e.g. getRollupsByDate>
---

# /new-data-access

Create a server-only data access function `$ARGUMENTS` in
`apps/dashboard/lib/data/`.

Conventions (see `.claude/rules/10-server-only-boundary.md`
and `.claude/rules/20-data-model-conventions.md`):

1. File starts with `import "server-only";`.
2. Imports the document client from `apps/dashboard/lib/dynamodb.ts` — never
   constructs a fresh client.
3. Inputs are typed (no `any`); date inputs are `YYYY-MM-DD` UTC strings.
4. Output is typed and validated against a Zod schema from
   `@bedrock-usage/shared` before returning.
5. **Any GSI1 query loops on `LastEvaluatedKey`** until the page key is
   absent. Do not assume a single page.
6. A missing item is represented as `null` (or a defined "never synced"
   state for `SyncStatus`), not thrown.
7. Add a Vitest test against DynamoDB Local: happy path + pagination if a GSI
   query is involved.

Steps:

1. Locate the access pattern in `docs/specs/2026-05-15-data-model.md`
   ("Access Patterns" tables). Refuse to invent new patterns.
2. Generate the function, its Zod-typed return, and the Vitest stub.
