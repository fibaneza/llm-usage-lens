import { z } from "zod";

import {
  accessErrorResponse,
  auditContext,
  entraConfigured,
} from "@/lib/api/access-route";
import { jsonData, parseJsonBody, withRoute } from "@/lib/api/respond";
import {
  getPasswordSignIn,
  setPasswordSignIn,
} from "@/lib/data/access/password-users";

// Source: docs/specs/2026-11-10-access-control.md - "API routes (additions)"
// (GET internal-admin or internal-auditor; PUT internal-admin) and "Password
// users" D24 (off is refused with 409 while Entra is not configured).
const BodySchema = z.object({
  enabled: z.boolean(),
  version: z.number().int().min(0),
});

export const GET = withRoute(async () => jsonData(await getPasswordSignIn()), {
  requireAdminOrAuditor: true,
});

export const PUT = withRoute(
  async (request, _ctx, session) => {
    const { enabled, version } = await parseJsonBody(request, BodySchema);
    const result = await setPasswordSignIn(
      { enabled, version, entraConfigured: entraConfigured() },
      auditContext(session),
    );
    if (!result.ok) return accessErrorResponse(result.code);
    return jsonData(result.value);
  },
  {
    requireAdmin: true,
    requireRecentAuth: true,
    denied: {
      action: "governance.passwordsignin.update",
      pattern: "/api/governance/password-sign-in",
    },
  },
);
