import "server-only";

import type { Session } from "next-auth";

import { env } from "@/env";
import { jsonError } from "@/lib/api/respond";
import { globalRolesOf } from "@/lib/auth/policy";
import type { ResolveScopeInput } from "@/lib/auth/policy";
import type { GlobalRole } from "@/lib/auth/roles";
import { loadAuthorization } from "@/lib/data/access/authorization";

import { LiteLLMError } from "./client";
import { LiteLLMOperationRefused } from "./gateway";

// Source: docs/specs/2026-11-10-litellm.md — "Security architecture" item 11
// (threat LT11): with AUTH_ACCESS_MODE=open there is no real identity to
// audit, so every LiteLLM route answers 403 OPERATION_UNAVAILABLE after the
// session check.
export function openModeRefusal(): Response | null {
  return env.AUTH_ACCESS_MODE === "open"
    ? jsonError(
        403,
        "OPERATION_UNAVAILABLE",
        "LiteLLM administration is unavailable in open access mode",
      )
    : null;
}

// A LiteLLM failure as the route's response (spec "API routes", error codes):
// a refused operation is 403 with its own code, any LiteLLM failure is 503
// LITELLM_UNAVAILABLE with fixed text. `null` for anything else (rethrow).
export function liteLLMErrorResponse(error: unknown): Response | null {
  if (error instanceof LiteLLMOperationRefused) {
    return jsonError(403, error.code, error.message);
  }
  if (error instanceof LiteLLMError) {
    return jsonError(503, error.code, error.message);
  }
  return null;
}

// Authorization is read per request, never cached (Rule 60.10).
export async function authorizationFor(
  session: Session | null,
): Promise<ResolveScopeInput> {
  return loadAuthorization({
    appEnv: env.APP_ENV === "prod" ? "prod" : "dev",
    session,
    teamIds: [],
    departmentIds: [],
  });
}

// Global roles = session claim plus stored role grants (Rule 50.4; Access
// Control spec - Roles). `null` fails closed.
export async function globalRolesFor(
  session: Session | null,
): Promise<GlobalRole[] | null> {
  const input = await authorizationFor(session);
  return globalRolesOf(session, input.appEnv, input.roleGrants);
}

// Admin or Auditor (the read side of every Settings -> LiteLLM route).
export async function adminOrAuditorRefusal(
  session: Session | null,
): Promise<Response | null> {
  const roles = await globalRolesFor(session);
  return roles?.some((r) => r === "internal-admin" || r === "internal-auditor")
    ? null
    : jsonError(403, "FORBIDDEN", "Admin or Auditor role required");
}

// Admin, Org Admin or Auditor: the read side of the toggles, connection and
// team-link routes (LiteLLM spec - LD24; Rule 10.3).
export async function litellmReadRefusal(
  session: Session | null,
): Promise<Response | null> {
  const roles = await globalRolesFor(session);
  return roles?.some(
    (r) =>
      r === "internal-admin" ||
      r === "internal-org-admin" ||
      r === "internal-auditor",
  )
    ? null
    : jsonError(403, "FORBIDDEN", "Admin, Org Admin or Auditor role required");
}

// `permit` for the toggle and team-link writes: internal-admin or
// internal-org-admin (LD24). Stored role grants count.
export async function permitAdminOrOrgAdmin(
  _request: Request,
  session: Session,
): Promise<boolean> {
  const roles = await globalRolesFor(session);
  return (
    roles?.some((r) => r === "internal-admin" || r === "internal-org-admin") ??
    false
  );
}
