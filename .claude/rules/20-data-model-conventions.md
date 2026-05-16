# Rule 20 — Data model conventions

Source: `docs/specs/2026-05-15-data-model.md`.

## Non-negotiables

1. **UTC everywhere.** `DAILY#{YYYY-MM-DD}` keys are UTC calendar days. Never
   bucket by local time.
2. **USD only.** All cost values are USD.
3. **Cost provenance.** Account-level and model-level cost (from Cost Explorer)
   is exact. Per-user and per-service cost is a proportional estimate and
   always carries `costEstimated: true`. Today's rollup is
   `costFinalized: false`; yesterday's is `costFinalized: true`.
4. **Model-first breakdown.** `DailyRollup.models` is keyed by canonical model
   ID. `byUser` and `byService` are nested *inside* each model entry — not at
   the top level.
5. **Model ID normalization lives in `packages/shared/src/models.ts`.** Map raw
   Bedrock model IDs to canonical keys (`claude-opus`, `claude-sonnet`,
   `claude-haiku`, `other`) → display name + chart CSS token. Do not duplicate
   the table in `apps/dashboard` or `apps/collector`.
6. **GSI1 queries must loop on `LastEvaluatedKey`.** Any `Query` against
   `gsi1pk`/`gsi1sk` can exceed DynamoDB's 1 MB page limit — paginate.
7. **Rankings are computed in-memory** in the API route after fetching all
   `DailyRollup`s for the date range via GSI1, then grouping and sorting.
   v1 targets ≤100 accounts × 30 days (~3k items).
8. **Custom date ranges are capped at 90 days** by `DateRangeQuerySchema`.
9. **A missing `SyncStatus` item is the "never synced" state, not an error.**
   Show a neutral message; never crash. `SyncCountdown` reads
   `nextScheduledAt` when present.
10. **`byService` comes from CloudTrail inference profiles** (`service=<name>`
    tag), not Cost Explorer billing tags. Untagged usage → `_untagged`.
11. **Standard response shape** (Route Handlers):
    - Success: `{ data: T }`
    - Error: `{ error: { code: string, message: string } }`
    Validate this shape with Zod on both server and client.
