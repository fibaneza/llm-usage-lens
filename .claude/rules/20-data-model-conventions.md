# Rule 20 — Data model conventions

Source: `docs/specs/2026-05-15-data-model.md`.

## Non-negotiables

1. **UTC everywhere.** `DAILY#{YYYY-MM-DD}` keys are UTC calendar days. Never
   bucket by local time.
2. **USD only.** All cost values are USD.
3. **Cost provenance.** Account-level, model-level and non-model cost (from
   Cost Explorer) is exact; the rollup `cost` equals `Σ models[*].cost +
   Σ nonModel[*].cost` within 1e-6. Per-user and per-service cost is a
   proportional estimate and always carries `costEstimated: true`. Today's
   rollup is `costFinalized: false`; yesterday's is `costFinalized: true`.
4. **Model-first breakdown.** `DailyRollup.models` is keyed by canonical model
   ID. `byUser` and `byService` are nested *inside* each model entry — not at
   the top level.
5. **Normalization lives in `packages/shared`.** Model IDs in `src/models.ts`;
   Cost Explorer usage types in `src/usage-type.ts` (`classifyUsageType`).
   Map raw Bedrock model IDs to canonical keys (`claude-opus`, `claude-sonnet`,
   `claude-haiku`, `other`) → display name + chart CSS token. Do not duplicate
   either table in `apps/dashboard` or `apps/collector`.
6. **GSI1 queries must loop on `LastEvaluatedKey`.** Any `Query` against
   `gsi1pk`/`gsi1sk` can exceed DynamoDB's 1 MB page limit — paginate.
7. **Rankings are computed in-memory** in the API route after fetching all
   `DailyRollup`s for the date range via GSI1, then grouping and sorting.
   v1 targets ≤100 accounts × 30 days (~3k items).
8. **Custom date ranges are capped at 90 days** by `DateRangeQuerySchema`.
9. **A missing `SyncStatus` item is the "never synced" state, not an error.**
   Show a neutral message; never crash. When the item exists,
   `nextScheduledAt` is required (`SyncStatusSchema`) and `SyncCountdown`
   reads it.
10. **`byService` comes from CloudTrail inference profiles** (`service=<name>`
    tag), not Cost Explorer billing tags. Untagged usage → `_untagged`.
11. **Standard response shape** (Route Handlers):
    - Success: `{ data: T }`
    - Error: `{ error: { code: string, message: string } }`
    Validate this shape with Zod on both server and client.
12. **Non-model charges are separate.** Guardrails, Provisioned Throughput,
    custom model storage/import, Knowledge Bases, Agents/Flows and other
    non-token charges live in `DailyRollup.nonModel`, never in a model's cost
    (not even `other`), never as tokens, never coerced to `0` when absent, and
    never split across users or services. Idle recurring cost still produces a
    rollup (Data Model spec — *Non-Model Charges*).
13. **Rollups carry their UTC `date`** (`YYYY-MM-DD`), written by the collector
    and seeds and derived from `SK` on read when absent. A stored `date` that
    disagrees with `SK` fails the read (the item is corrupt).
14. **`byUser` keys are canonical usage identities** — the lower-cased email
    after the CloudTrail SSO prefix, from the one function in
    `packages/shared` (Access Control spec — *Canonical usage identity*).
    The dashboard canonicalises on read until Phase 6; non-email session
    names stay raw with `kind: "non-person"`.
