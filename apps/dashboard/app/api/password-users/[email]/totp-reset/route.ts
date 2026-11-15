import { accessErrorResponse, auditContext } from "@/lib/api/access-route";
import {
  parsePathEmail,
  userResponse,
  type PasswordUserRouteContext,
} from "@/lib/api/password-user-route";
import { withRoute } from "@/lib/api/respond";
import { resetPasswordUserTotp } from "@/lib/data/access/password-credentials-store";

// Source: docs/specs/2026-11-10-access-control.md - "Password users" (TOTP
// D23: an admin reset clears the enrolment; re-enrolment happens at the next
// sign-in), "API routes (additions)" (internal-admin). No request body.
const handler = withRoute(
  async (_request, ctx, session) => {
    const email = parsePathEmail((await ctx.params).email);
    const result = await resetPasswordUserTotp(email, auditContext(session));
    if (!result.ok) return accessErrorResponse(result.code);
    return userResponse(email);
  },
  {
    requireAdmin: true,
    requireRecentAuth: true,
    denied: {
      action: "localuser.update",
      pattern: "/api/password-users/[email]/totp-reset",
    },
  },
);

export const POST = (request: Request, ctx: PasswordUserRouteContext) =>
  handler(request, ctx);
