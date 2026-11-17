import { z } from "zod";

import { LiteLLMGatewayConfigSchema } from "./litellm-gateway";

// Source: docs/specs/2026-05-15-system-architecture.md — "Configuration file"
// (v1 keys; A4 one strict schema; Q2/Q3: no secrets, no authorization
// assignments). Every object is strict, so an unknown key — a secret-shaped
// one (`apiKey`, `password`), an authorization one (`roles`, `adminScopes`) or
// a typo — fails the whole file. `litellm` is the former gateway schema (A8).
export const AppConfigSchema = z.strictObject({
  litellm: LiteLLMGatewayConfigSchema.optional(),
  display: z
    .strictObject({
      defaultDateRange: z.enum(["7d", "30d", "90d"]).optional(),
      orgName: z.string().min(1).optional(),
    })
    .optional(),
  data: z
    .strictObject({
      retention: z
        .strictObject({
          dailyRollupDays: z.number().int().min(30).max(3650).optional(),
        })
        .optional(),
    })
    .optional(),
});
export type AppConfig = z.infer<typeof AppConfigSchema>;
