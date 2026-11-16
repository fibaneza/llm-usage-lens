import { z } from "zod";

// Source: docs/specs/2026-11-10-access-control.md - "API routes (additions)"
// (/api/me, /api/me/usage: any signed-in role). /api/me also carries the
// caller's own scope for the UI (implementation-phases Phase 4R.5).

export const MeResponseSchema = z.object({
  oid: z.string(),
  email: z.string().nullable(),
  roles: z.array(z.string()),
  usageIdentities: z.array(z.string()),
  global: z.boolean(),
  memberTeamId: z.string().nullable(),
  memberTeamVisible: z.boolean(),
  teamScopes: z.array(z.string()),
  departmentScopes: z.array(z.string()),
});

const TotalsSchema = z.object({
  cost: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  invocations: z.number(),
});

export const MeUsageResponseSchema = z.object({
  totals: TotalsSchema,
  daily: z.array(TotalsSchema.extend({ date: z.string() })),
});
