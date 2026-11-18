import "server-only";

import { randomUUID } from "node:crypto";

import type { AuditAction } from "@llm-usage-lens/shared";
import type { Session } from "next-auth";

import { jsonError } from "@/lib/api/respond";
import { appendDeniedAudit } from "@/lib/data/access/audit";
import { LiteLLMError } from "@/lib/litellm/client";
import { NON_PRIVILEGED_ROLES } from "@/lib/litellm/member-write";
import { getUser } from "@/lib/litellm/operations";

// Source: docs/specs/2026-11-10-access-control.md - "LiteLLM user links" (D16;
// privileged targets refused `409 PRIVILEGED_TARGET`, match email check),
// LiteLLM spec - LT18, LT-MI1, `getUser` (server-side read for the link
// writes). Shared by the litellm-link PUT and `POST /api/litellm/users`.

export type LinkTarget =
  | { ok: true; email: string | null }
  | { ok: false; response: Response };

// Reads the LiteLLM user and refuses a privileged one: a `user_role` that is
// not internal_user or internal_user_viewer (a missing role fails closed), or
// the service user (which holds a proxy role). Writes one `denied` record and
// no link. An unknown user is a `400` (LiteLLM does not know it).
export async function readLinkTarget(
  request: Request,
  session: Session,
  litellmUserId: string,
  action: AuditAction,
  pattern: string,
): Promise<LinkTarget> {
  let info: Awaited<ReturnType<typeof getUser>>;
  try {
    info = await getUser({ litellmUserId });
  } catch (error) {
    if (
      error instanceof LiteLLMError &&
      error.detail === "upstream_error" &&
      (error.status === 404 || error.status === 400)
    ) {
      return {
        ok: false,
        response: jsonError(
          400,
          "BAD_REQUEST",
          "LiteLLM does not know that user",
        ),
      };
    }
    throw error;
  }
  const role = info.user_info?.user_role;
  if (!role || !NON_PRIVILEGED_ROLES.includes(role)) {
    await appendDeniedAudit({
      actor: session.user.oid,
      action,
      requestId: randomUUID(),
      code: "PRIVILEGED_TARGET",
      route: { method: request.method, pattern },
      target: { type: "litellm-user", id: litellmUserId },
    });
    return {
      ok: false,
      response: jsonError(
        409,
        "PRIVILEGED_TARGET",
        "The target holds a privileged LiteLLM role",
      ),
    };
  }
  return { ok: true, email: info.user_info?.user_email?.toLowerCase() ?? null };
}
