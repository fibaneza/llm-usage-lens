import { z } from "zod";

import {
  accessErrorResponse,
  auditContext,
  entraConfigured,
} from "@/lib/api/access-route";
import {
  parsePathEmail,
  userResponse,
  type PasswordUserRouteContext,
} from "@/lib/api/password-user-route";
import { jsonData, parseJsonBody, withRoute } from "@/lib/api/respond";
import {
  deletePasswordUser,
  disablePasswordUser,
  enablePasswordUser,
  passwordAdminGuard,
} from "@/lib/data/access/password-users";

// Source: docs/specs/2026-11-10-access-control.md - "API routes (additions)"
// (PATCH, DELETE internal-admin), "Password users" (Accounts: the last enabled
// password internal-admin is protected while Entra is not configured),
// "Enforcement" item 6 (stale version -> 409).
const PatchSchema = z.object({
  enabled: z.boolean(),
  version: z.number().int().min(0),
});
const PATTERN = "/api/password-users/[email]";

const patchHandler = withRoute(
  async (request, ctx, session) => {
    const email = parsePathEmail((await ctx.params).email);
    const { enabled, version } = await parseJsonBody(request, PatchSchema);
    const guard =
      !enabled && !entraConfigured()
        ? await passwordAdminGuard(email)
        : ({ protected: false } as const);
    if (guard.protected && !guard.other) return accessErrorResponse("CONFLICT");
    const ctxAudit = auditContext(session);
    const result = enabled
      ? await enablePasswordUser(email, ctxAudit, version)
      : await disablePasswordUser(
          email,
          ctxAudit,
          version,
          guard.protected && guard.other ? guard.other : undefined,
        );
    if (!result.ok) return accessErrorResponse(result.code);
    return userResponse(email);
  },
  {
    requireAdmin: true,
    denied: { action: "localuser.update", pattern: PATTERN },
  },
);

const deleteHandler = withRoute(
  async (_request, ctx, session) => {
    const email = parsePathEmail((await ctx.params).email);
    const guard = entraConfigured()
      ? ({ protected: false } as const)
      : await passwordAdminGuard(email);
    if (guard.protected && !guard.other) return accessErrorResponse("CONFLICT");
    const result = await deletePasswordUser(
      email,
      auditContext(session),
      guard.protected && guard.other ? guard.other : undefined,
    );
    if (!result.ok) return accessErrorResponse(result.code);
    return jsonData({ deleted: true });
  },
  {
    requireAdmin: true,
    requireRecentAuth: true,
    denied: { action: "localuser.delete", pattern: PATTERN },
  },
);

export const PATCH = (request: Request, ctx: PasswordUserRouteContext) =>
  patchHandler(request, ctx);
export const DELETE = (request: Request, ctx: PasswordUserRouteContext) =>
  deleteHandler(request, ctx);
