import "server-only";

import type { AuditAction } from "@llm-usage-lens/shared";
import type { Session } from "next-auth";

import { env } from "@/env";
import {
  NOT_FOUND_MESSAGE,
  jsonError,
  recordDeniedWrite,
  withRoute,
} from "@/lib/api/respond";
import type { RouteContext } from "@/lib/api/respond";
import { decideWrite, mayAttempt } from "@/lib/auth/write-policy";
import type {
  MatrixOperation,
  MatrixTarget,
  WriteActor,
} from "@/lib/auth/write-policy";
import { loadWriteActor } from "@/lib/data/access/authorization";

// Source: docs/specs/2026-11-10-access-control.md - "Permission matrix",
// "Enforcement" item 2 (403 before parsing; one 404 for a missing and an
// out-of-scope target), "Audit log" D17 (one `denied` record per authorization
// refusal, none for a target that does not exist, none on a read). The shared
// frame of the members, admin-scope, visibility and move writes.

const appEnv = (): "dev" | "prod" => (env.APP_ENV === "prod" ? "prod" : "dev");

export function notFoundResponse(): Response {
  return jsonError(404, "NOT_FOUND", NOT_FOUND_MESSAGE);
}

export type MatrixConfig = {
  operation: MatrixOperation;
  action: AuditAction;
  // The route's fixed pattern; the raw path is never recorded.
  pattern: string;
};

export type MatrixArgs = {
  request: Request;
  params: Record<string, string | undefined>;
  session: Session;
  actor: WriteActor;
  // Null when allowed; otherwise the 403 or 404 to return, with the `denied`
  // record already written where D17 asks for one.
  refuse: (target: MatrixTarget) => Promise<Response | null>;
};

export function matrixWrite(
  config: MatrixConfig,
  handler: (args: MatrixArgs) => Promise<Response>,
) {
  // The actor loaded by `permit` travels to the handler on the request object
  // withRoute passes to both, so it is read once per request.
  const actors = new WeakMap<Request, WriteActor>();
  const denied = { action: config.action, pattern: config.pattern };
  return withRoute(
    async (request, ctx: RouteContext, session) => {
      const actor = actors.get(request);
      if (!actor) throw new Error("matrix write reached without an actor");
      const refuse = async (target: MatrixTarget) => {
        const verdict = decideWrite(actor, target);
        if (verdict === "allow") return null;
        if (verdict === "missing") return notFoundResponse();
        const forbidden = verdict === "forbidden";
        await recordDeniedWrite(
          request,
          session.user.oid,
          denied,
          forbidden ? "FORBIDDEN" : "NOT_FOUND",
        );
        return forbidden
          ? jsonError(403, "FORBIDDEN", "Insufficient permission")
          : notFoundResponse();
      };
      return handler({
        request,
        params: await ctx.params,
        session,
        actor,
        refuse,
      });
    },
    {
      permit: async (request, session) => {
        const actor = await loadWriteActor({ appEnv: appEnv(), session });
        if (!actor || !mayAttempt(actor, config.operation)) return false;
        actors.set(request, actor);
        return true;
      },
      denied,
    },
  );
}

// The caller as a reader of management data (members, admins, visibility).
export async function loadManager(
  session: Session,
): Promise<WriteActor | null> {
  return loadWriteActor({ appEnv: appEnv(), session });
}
