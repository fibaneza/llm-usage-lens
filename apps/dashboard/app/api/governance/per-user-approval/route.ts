import { z } from "zod";

import { accessErrorResponse, auditContext } from "@/lib/api/access-route";
import { jsonData, parseJsonBody, withRoute } from "@/lib/api/respond";
import {
  getPerUserApproval,
  setPerUserApproval,
} from "@/lib/data/access/per-user-approval";

// Source: docs/specs/2026-11-10-access-control.md - "API routes (additions)":
// GET internal-admin or internal-auditor, PUT internal-admin; "Visibility and
// inheritance" (organisation cap: who = the session, when = now, reference).
// The spec defines no withdrawal, so there is no DELETE.
const BodySchema = z.object({
  reference: z.string().min(1).max(200),
  version: z.number().int().min(0),
});

export const GET = withRoute(
  async () => {
    const approval = await getPerUserApproval();
    return jsonData(
      approval ? { approved: true, ...approval } : { approved: false },
    );
  },
  { requireAdminOrAuditor: true },
);

export const PUT = withRoute(
  async (request, _ctx, session) => {
    const { reference, version } = await parseJsonBody(request, BodySchema);
    const result = await setPerUserApproval(
      { reference, version },
      auditContext(session),
    );
    if (!result.ok) return accessErrorResponse(result.code);
    return jsonData({ approved: true, ...result.value });
  },
  {
    requireAdmin: true,
    denied: {
      action: "governance.approval.update",
      pattern: "/api/governance/per-user-approval",
    },
  },
);
