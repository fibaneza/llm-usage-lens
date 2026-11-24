import { z } from "zod";

import {
  accessErrorResponse,
  auditContext,
  listOptions,
} from "@/lib/api/access-route";
import { jsonData, parseSearchParams, withRoute } from "@/lib/api/respond";
import { viewAuditDay } from "@/lib/data/access/audit-view";

// Source: docs/specs/2026-11-10-access-control.md - "API routes (additions)"
// (/api/audit GET internal-admin or internal-auditor, audited), "Audit log"
// (audit-log views are themselves audited), "Data model additions" (audit by
// UTC day). Never cached: Enforcement item 4.
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const DayQuerySchema = z.object({
  day: z
    .string()
    .regex(DAY, "day must be YYYY-MM-DD")
    .refine((day) => {
      const parsed = new Date(`${day}T00:00:00.000Z`);
      return (
        !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(day)
      );
    }, "day is not a calendar date")
    .optional(),
  // Unit SRT1 (D-SR1): oldest first (the previous order) by default.
  dir: z.enum(["asc", "desc"]).default("asc"),
});

export const GET = withRoute(
  async (request, _ctx, session) => {
    const { day, dir } = parseSearchParams(request, DayQuerySchema);
    const ctx = auditContext(session);
    const utcDay = day ?? ctx.now.toISOString().slice(0, 10);
    const result = await viewAuditDay(utcDay, listOptions(request), ctx, dir);
    if (!result.ok) return accessErrorResponse(result.code);
    return jsonData(result.value);
  },
  { requireAdminOrAuditor: true },
);
