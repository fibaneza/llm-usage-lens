import { adminScopeHandlers } from "@/lib/api/admin-scope-routes";

// Source: docs/specs/2026-11-10-access-control.md - "API routes (additions)":
// DELETE per the permission matrix.
const handlers = adminScopeHandlers("department");
type ScopeContext = { params: Promise<{ id: string; oid: string }> };

export const DELETE = (request: Request, ctx: ScopeContext) =>
  handlers.revoke(request, ctx);
