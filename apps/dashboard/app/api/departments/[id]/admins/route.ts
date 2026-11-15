import { adminScopeHandlers } from "@/lib/api/admin-scope-routes";

// Source: docs/specs/2026-11-10-access-control.md - "API routes (additions)":
// GET read in scope, POST per the permission matrix.
const handlers = adminScopeHandlers("department");
type ScopeContext = { params: Promise<{ id: string }> };

export const GET = (request: Request, ctx: ScopeContext) =>
  handlers.list(request, ctx);
export const POST = (request: Request, ctx: ScopeContext) =>
  handlers.grant(request, ctx);
