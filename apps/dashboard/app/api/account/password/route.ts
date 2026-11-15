import { z } from "zod";

import { auditContext } from "@/lib/api/access-route";
import {
  jsonData,
  jsonError,
  parseJsonBody,
  withRoute,
} from "@/lib/api/respond";
import { changeOwnPassword } from "@/lib/auth/password-change";

// Source: docs/specs/2026-11-10-access-control.md - "API routes (additions)":
// POST /api/account/password is the signed-in password user changing their own
// password; "Enforcement" items 2, 4, 6. The identity is the session's, never
// the body's. Entra, master and dev-login sessions are 403 before parsing.
const BodySchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(1).max(1024),
  totp: z.string().max(16).optional(),
});

export const POST = withRoute(
  async (request, _ctx, session) => {
    const input = await parseJsonBody(request, BodySchema);
    const result = await changeOwnPassword(
      {
        oid: session.user.oid,
        email: session.user.email ?? "",
        currentPassword: input.currentPassword,
        newPassword: input.newPassword,
        ...(session.user.signedInAt !== undefined
          ? { signedInAt: session.user.signedInAt }
          : {}),
        ...(input.totp !== undefined ? { totp: input.totp } : {}),
      },
      auditContext(session),
    );
    if (result.ok) return jsonData({});
    if (result.code === "WEAK_PASSWORD") {
      return jsonError(400, "WEAK_PASSWORD", "The new password is not allowed");
    }
    if (result.code === "SSO_BOUND") {
      return jsonError(
        409,
        "SSO_BOUND",
        "This account signs in with single sign-on",
      );
    }
    return jsonError(403, "FORBIDDEN", "Could not change the password");
  },
  {
    permit: async (_request, session) => session.user.authMethod === "password",
    denied: { action: "localuser.update", pattern: "/api/account/password" },
  },
);
