import { z } from "zod";

import { ModelKeySchema } from "../models";

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
  // The caller's team lead, for the "Request a budget increase" mailto link
  // (Design System - Management pages, My usage); absent when none is known.
  leadEmail: z.string().nullish(),
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
  // Own cost per canonical model (spend-by-model chart, slice B2 B2-11).
  byModel: z.array(TotalsSchema.extend({ model: ModelKeySchema })).default([]),
});
