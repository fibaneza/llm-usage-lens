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
  updatePasswordUserDisplayName,
} from "@/lib/data/access/password-users";

// Source: docs/specs/2026-11-10-access-control.md - "API routes (additions)"
// (PATCH, DELETE internal-admin), "Password users" (Accounts: the last enabled
// password internal-admin is protected while Entra is not configured),
// "Enforcement" item 6 (stale version -> 409).
// Unit US2 (D-US8): the status change or the name, never both and never the
// email (strict objects reject it).
const VersionSchema = z.number().int().min(0);
const PatchSchema = z.union([
  z.strictObject({ enabled: z.boolean(), version: VersionSchema }),
  z.strictObject({
    displayName: z
      .string()
      .trim()
      .min(1)
      .max(200)
      // eslint-disable-next-line no-control-regex -- control characters are rejected on purpose (D-US8)
      .regex(/^[^\u0000-\u001F\u007F]*$/),
    version: VersionSchema,
  }),
]);
const DeleteSchema = z.object({ version: z.number().int().min(0) });
const PATTERN = "/api/password-users/[email]";

const patchHandler = withRoute(
  async (request, ctx, session) => {
    const email = parsePathEmail((await ctx.params).email);
    const body = await parseJsonBody(request, PatchSchema);
    if ("displayName" in body) {
      const renamed = await updatePasswordUserDisplayName(
        email,
        body.displayName,
        auditContext(session),
        body.version,
      );
      if (!renamed.ok) return accessErrorResponse(renamed.code);
      return userResponse(email);
    }
    const { enabled, version } = body;
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
  async (request, ctx, session) => {
    const email = parsePathEmail((await ctx.params).email);
    const { version } = await parseJsonBody(request, DeleteSchema);
    const guard = entraConfigured()
      ? ({ protected: false } as const)
      : await passwordAdminGuard(email);
    if (guard.protected && !guard.other) return accessErrorResponse("CONFLICT");
    const result = await deletePasswordUser(
      email,
      auditContext(session),
      guard.protected && guard.other ? guard.other : undefined,
      version,
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
