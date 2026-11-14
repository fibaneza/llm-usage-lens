import { z } from "zod";

import { env } from "@/env";
import { accessErrorResponse, auditContext } from "@/lib/api/access-route";
import { jsonData, parseJsonBody, withRoute } from "@/lib/api/respond";
import {
  getPasswordSignIn,
  setPasswordSignIn,
} from "@/lib/data/access/password-users";

// Source: docs/specs/2026-11-10-access-control.md - "API routes (additions)"
// (GET internal-admin or internal-auditor; PUT internal-admin) and "Password
// users" D24 (off is refused with 409 while Entra is not configured).
const BodySchema = z.object({ enabled: z.boolean() });

const entraConfigured = (): boolean =>
  Boolean(
    env.AUTH_MICROSOFT_ENTRA_ID_ID &&
    env.AUTH_MICROSOFT_ENTRA_ID_SECRET &&
    env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
  );

export const GET = withRoute(async () => jsonData(await getPasswordSignIn()), {
  requireAdminOrAuditor: true,
});

export const PUT = withRoute(
  async (request, _ctx, session) => {
    const { enabled } = await parseJsonBody(request, BodySchema);
    const result = await setPasswordSignIn(
      { enabled, entraConfigured: entraConfigured() },
      auditContext(session),
    );
    if (!result.ok) return accessErrorResponse(result.code);
    return jsonData(result.value);
  },
  {
    requireAdmin: true,
    denied: {
      action: "governance.passwordsignin.update",
      pattern: "/api/governance/password-sign-in",
    },
  },
);
