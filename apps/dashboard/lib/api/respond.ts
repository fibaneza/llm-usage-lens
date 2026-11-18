import "server-only";

import { randomUUID } from "node:crypto";

import { SpanStatusCode, trace } from "@opentelemetry/api";
import type { ApiErrorCode, AuditAction } from "@llm-usage-lens/shared";
import { ZodError } from "zod";
import type { Session } from "next-auth";
import type { ZodType, z } from "zod";

import { auth } from "@/auth";
import { unauthenticatedResponse } from "@/lib/api/unauthenticated";
import { hasRecentAuth } from "@/lib/auth/recent-auth";
import {
  INTERNAL_ADMIN_ROLE,
  INTERNAL_AUDITOR_ROLE,
  hasGlobalRole,
} from "@/lib/auth/roles";
import type { GlobalRole } from "@/lib/auth/roles";

// Source: docs/specs/2026-05-15-data-model.md — "API Routes"; Rule 10.3,
// Rule 50.4 (401 before any data access), Rule 50.6, Rule 60.18; System
// Architecture — "Account-mutation role" (403 for the account write routes).

// Out-of-scope and nonexistent details share one body: no id, no hint
// (Access Control spec - Enforcement item 2).
export const NOT_FOUND_MESSAGE = "Not found";

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

// Thrown only for failures parsing request input; maps to 400. Any other
// ZodError is a server-side contract failure and maps to 500 (no schema text).
// Zod v4 classes use trait-based `instanceof`, so a plain ZodError would also
// match a subclass check; a brand field distinguishes them.
const BAD_REQUEST_BRAND = Symbol("bad-request");

export function isBadRequestError(error: unknown): error is BadRequestError {
  return (
    error instanceof ZodError &&
    (error as { [BAD_REQUEST_BRAND]?: true })[BAD_REQUEST_BRAND] === true
  );
}

export class BadRequestError extends ZodError {
  readonly [BAD_REQUEST_BRAND] = true;

  constructor(issues: ZodError["issues"]) {
    super(issues);
    this.name = "BadRequestError";
  }

  get firstMessage(): string {
    return this.issues[0]?.message ?? "Invalid request";
  }
}

// Access Control spec — Enforcement: every /api/* response is private, no-store.
const NO_STORE = "private, no-store";

export type RouteContext = {
  params: Promise<Record<string, string | undefined>>;
};

export function jsonData<T>(data: T, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", NO_STORE);
  return Response.json({ data }, { ...init, headers });
}

export function jsonError(
  status: 400 | 401 | 403 | 404 | 409 | 422 | 500 | 503,
  code: ApiErrorCode,
  message: string,
): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": NO_STORE } },
  );
}

export function parseInput<S extends ZodType>(
  input: unknown,
  schema: S,
): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new BadRequestError(result.error.issues);
  }
  return result.data as z.output<S>;
}

export function parseSearchParams<S extends ZodType>(
  request: Request,
  schema: S,
): z.output<S> {
  return parseInput(
    Object.fromEntries(new URL(request.url).searchParams),
    schema,
  );
}

export async function parseJsonBody<S extends ZodType>(
  request: Request,
  schema: S,
): Promise<z.output<S>> {
  const essence = (request.headers.get("content-type") ?? "")
    .split(";")[0]
    ?.trim()
    .toLowerCase();
  if (essence !== "application/json") {
    throw new BadRequestError([
      {
        code: "custom",
        message: "Content-Type must be application/json",
        path: [],
        input: undefined,
      },
    ]);
  }
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw new BadRequestError([
      {
        code: "custom",
        message: "Request body must be valid JSON",
        path: [],
        input: undefined,
      },
    ]);
  }
  return parseInput(payload, schema);
}

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Access Control spec — Enforcement: writes must carry a same-origin Origin.
// The Host header is never overridden by x-forwarded-host.
function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return false;
  const host = request.headers.get("host") || new URL(request.url).host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

// Effective roles are the claim plus in-app grants, read per request and never
// cached (Access Control spec - Roles, Enforcement item 4; Rule 60.10), for
// every sign-in method. The grant read happens only when the claim alone does
// not answer; loadWriteActor and resolveScope apply the same union.
async function holdsAnyRole(
  session: Session,
  roles: readonly GlobalRole[],
): Promise<boolean> {
  if (roles.some((role) => hasGlobalRole(session, role))) return true;
  const { loadGrantedRoles } = await import("@/lib/data/access/authorization");
  const granted = await loadGrantedRoles(session.user.oid);
  return roles.some((role) => granted.includes(role));
}

const tracer = trace.getTracer("bedrock-usage-dashboard");

export type RouteOptions = {
  requireAdmin?: boolean;
  // Read routes open to internal-admin and internal-auditor (Access Control
  // spec - API routes (additions)). Enforced right after the session check,
  // like `requireAdmin`; a refusal records no denied audit (D17: writes only).
  requireAdminOrAuditor?: boolean;
  // Needs a sign-in within the last 15 minutes (Access Control spec - Recent
  // authentication, D28): 403 REAUTH_REQUIRED after the session, role and
  // origin checks and before parsing. Records no denied audit.
  requireRecentAuth?: boolean;
  // The operation and fixed route pattern a `requireAdmin` refusal records
  // (Access Control spec - Audit log D17, T22); never the raw path.
  // May be a function of the request when one route records different actions
  // (toggles update vs reset); it must read the request without validating it.
  denied?: DeniedRecord | ((request: Request) => Promise<DeniedRecord>);
  // A permission the route decides itself (the matrix writes, which depend on
  // the caller's scopes): false is a 403 with the `denied` record, right after
  // the session check and before the origin check and any parsing.
  permit?: (request: Request, session: Session) => Promise<boolean>;
};

type DeniedRecord = { action: AuditAction; pattern: string };

// Best-effort: a failed record write never changes the response (D17). The
// request id is generated here, never taken from a header.
export async function recordDeniedWrite(
  request: Request,
  actor: string,
  denied: NonNullable<RouteOptions["denied"]>,
  code:
    | "FORBIDDEN"
    | "NOT_FOUND"
    | "PRIVILEGED_TARGET"
    | "CONFIG_FILE_LOCKED" = "FORBIDDEN",
): Promise<void> {
  try {
    const record =
      typeof denied === "function" ? await denied(request.clone()) : denied;
    const { appendDeniedAudit } = await import("@/lib/data/access/audit");
    await appendDeniedAudit({
      actor,
      action: record.action,
      requestId: randomUUID(),
      code,
      route: { method: request.method, pattern: record.pattern },
    });
  } catch (error) {
    trace
      .getActiveSpan()
      ?.recordException(
        error instanceof Error ? error : new Error("denied audit failed"),
      );
  }
}

// Each request runs in its own span so recordException always lands (Rule
// 60.17). The span name is fixed and carries no attributes: nothing from env,
// headers, cookies or the query string reaches telemetry (Rule 50.6).
// `requireAdmin` rejects a signed-in non-admin with 403 right after the session
// check, so the role is enforced before the handler parses input or reads data.
export function withRoute(
  handler: (
    request: Request,
    ctx: RouteContext,
    session: Session,
  ) => Promise<Response>,
  options: RouteOptions = {},
) {
  return (request: Request, ctx: RouteContext): Promise<Response> =>
    tracer.startActiveSpan("api.route", async (span) => {
      try {
        const session = await auth();
        if (typeof session?.user?.oid !== "string" || session.user.oid === "") {
          return unauthenticatedResponse();
        }
        if (
          options.requireAdmin &&
          !(await holdsAnyRole(session, [INTERNAL_ADMIN_ROLE]))
        ) {
          if (options.denied) {
            await recordDeniedWrite(
              request,
              session.user?.oid ?? "unknown",
              options.denied,
            );
          }
          return jsonError(
            403,
            "FORBIDDEN",
            `${INTERNAL_ADMIN_ROLE} role required`,
          );
        }
        if (options.permit && !(await options.permit(request, session))) {
          if (options.denied) {
            await recordDeniedWrite(request, session.user.oid, options.denied);
          }
          return jsonError(403, "FORBIDDEN", "Insufficient permission");
        }
        if (
          options.requireAdminOrAuditor &&
          !(await holdsAnyRole(session, [
            INTERNAL_ADMIN_ROLE,
            INTERNAL_AUDITOR_ROLE,
          ]))
        ) {
          return jsonError(
            403,
            "FORBIDDEN",
            `${INTERNAL_ADMIN_ROLE} or ${INTERNAL_AUDITOR_ROLE} role required`,
          );
        }
        if (WRITE_METHODS.has(request.method) && !isSameOrigin(request)) {
          return jsonError(403, "FORBIDDEN", "Cross-origin request rejected");
        }
        if (
          options.requireRecentAuth &&
          !hasRecentAuth(session.user.authTime, Math.floor(Date.now() / 1000))
        ) {
          // No attributes: nothing personal in telemetry (Rule 50.6).
          span.addEvent("reauth.required");
          return jsonError(
            403,
            "REAUTH_REQUIRED",
            "Re-authentication required",
          );
        }
        return await handler(request, ctx, session);
      } catch (error) {
        if (isBadRequestError(error)) {
          return jsonError(400, "BAD_REQUEST", error.firstMessage);
        }
        if (error instanceof NotFoundError) {
          return jsonError(404, "NOT_FOUND", error.message);
        }
        span.recordException(error instanceof Error ? error : String(error));
        span.setStatus({ code: SpanStatusCode.ERROR });
        return jsonError(500, "INTERNAL", "Internal server error");
      } finally {
        span.end();
      }
    });
}
