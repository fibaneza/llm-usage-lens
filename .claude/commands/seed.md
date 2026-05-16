---
description: Bring up DynamoDB Local, create the table, and seed data
argument-hint: <seed variant: default | empty | large | ranking>
---

# /seed

Bring up DynamoDB Local and load seed data. `$ARGUMENTS` selects the seed
script (default: `seed`).

Steps:

1. Start DynamoDB Local: `docker compose up -d dynamodb-local`.
2. Wait for it to become healthy (poll `docker compose ps`).
3. Create the table: `pnpm tsx scripts/create-table.ts` (idempotent per Phase
   3 spec).
4. Run the requested seed script:
   - `default` → `pnpm tsx scripts/seed.ts`
   - `empty` → `pnpm tsx scripts/seed-empty.ts`
   - `large` → `pnpm tsx scripts/seed-large.ts`
   - `ranking` → `pnpm tsx scripts/seed-ranking.ts` (optional)
5. Verify with a count scan and print a one-line summary
   (`accounts`, `daily rollups`, presence of `SyncStatus`).

If `docker-compose.yml` or the scripts do not exist yet, report that Phase 3
hasn't been completed and stop.
