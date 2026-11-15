import { accessErrorResponse, auditContext } from "@/lib/api/access-route";
import {
  parsePathEmail,
  setupLink,
  userResponse,
  type PasswordUserRouteContext,
} from "@/lib/api/password-user-route";
import { withRoute } from "@/lib/api/respond";
import { issueSetupLink } from "@/lib/data/access/password-users";

// Source: docs/specs/2026-11-10-access-control.md - "Password users" (Setup
// D22: a reset issues a new link once and invalidates the old one), "API
// routes (additions)" (internal-admin). No request body.
const handler = withRoute(
  async (request, ctx, session) => {
    const email = parsePathEmail((await ctx.params).email);
    const result = await issueSetupLink(email, auditContext(session));
    if (!result.ok) return accessErrorResponse(result.code);
    return userResponse(email, {
      setupLink: setupLink(request, result.value.setupToken),
    });
  },
  {
    requireAdmin: true,
    requireRecentAuth: true,
    denied: {
      action: "localuser.update",
      pattern: "/api/password-users/[email]/reset",
    },
  },
);

export const POST = (request: Request, ctx: PasswordUserRouteContext) =>
  handler(request, ctx);
