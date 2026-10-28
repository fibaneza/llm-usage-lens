---
description: Bring up DynamoDB Local, create the table, and seed data
argument-hint: <seed variant: default | empty | large | ranking>
---

# /seed

Bring up DynamoDB Local and load seed data. `$ARGUMENTS` selects the seed
script (default: `seed`).

Steps:

1. Start DynamoDB Local. The compose file lives at
   `.devcontainer/docker-compose.yml`, so from the host run
   `docker compose -f .devcontainer/docker-compose.yml up -d dynamodb-local`
   (inside the devcontainer, plain `docker compose up -d dynamodb-local` from
   `.devcontainer/` works).
2. Wait for it to become healthy (poll
   `docker compose -f .devcontainer/docker-compose.yml ps`).
3. Create the table: `pnpm db:create-table` (idempotent per Phase 3 spec).
4. Run the requested seed script:
   - `default` → `pnpm db:seed`
   - `empty` → `pnpm db:seed:empty`
   - `large` → `pnpm db:seed:large`
   - `ranking` → `pnpm db:seed:ranking` (optional)

   `pnpm tsx scripts/<file>.ts` is equivalent (the `db:*` scripts land with
   Phase 3.2).
5. Verify with a count scan and print a one-line summary
   (`accounts`, `daily rollups`, presence of `SyncStatus`).

Scripts target DynamoDB Local only (`http://localhost:8000` by default) and
refuse non-local endpoints.

If `scripts/create-table.ts` does not exist yet, report that Phase 3.2 hasn't
been completed and stop.
