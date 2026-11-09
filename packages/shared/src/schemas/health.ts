import { z } from "zod";

// Source: docs/specs/2026-11-10-platform.md — "Runtime / Health check";
// docs/specs/2026-11-10-access-control.md — "API routes" (/api/health).
export const HealthResponseSchema = z.object({
  data: z
    .object({
      status: z.enum(["ok", "degraded"]),
      dependencies: z
        .object({
          dynamodb: z.enum(["ok", "unreachable"]),
          litellm: z.enum(["ok", "unreachable", "not-configured"]),
        })
        .strict(),
    })
    .strict(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
