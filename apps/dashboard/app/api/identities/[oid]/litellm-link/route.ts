import {
  LiteLLMLinkDeleteBodySchema,
  LiteLLMLinkPutBodySchema,
  LiteLLMLinkResultSchema,
} from "@llm-usage-lens/shared";

import { accessErrorResponse, auditContext } from "@/lib/api/access-route";
import { IdParamSchema } from "@/lib/api/id-param";
import { readLinkTarget } from "@/lib/api/litellm-user-link";
import { notFoundResponse } from "@/lib/api/matrix-route";
import {
  jsonData,
  jsonError,
  parseInput,
  parseJsonBody,
  withRoute,
} from "@/lib/api/respond";
import type { RouteContext } from "@/lib/api/respond";
import { identityExists, ownEmail } from "@/lib/data/access/identities";
import { writeLiteLLMUserLink } from "@/lib/data/access/identity-links";
import { matchLiteLLMUser } from "@/lib/data/access/litellm-match";
import { liteLLMResponse } from "@/lib/litellm/read-views";
import {
  openModeRefusal,
  permitAdminOrOrgAdmin,
} from "@/lib/litellm/route-guard";
import type { Session } from "next-auth";

// Source: docs/specs/2026-11-10-access-control.md - "LiteLLM user links" (D16)
// and "API routes" (`internal-admin`, `internal-org-admin`; own `oid` `403`
// before parsing with one `denied` record; match needs the identity's verified
// canonical email, manual needs a reason; privileged target `409`; no recent
// authentication), LiteLLM spec LT18, T-MI1. The link, its claim and its audit
// record are one transaction (`writeLiteLLMUserLink`).

export const dynamic = "force-dynamic";

const PATTERN = "/api/identities/[oid]/litellm-link";
const SET = "identity.litellm-link.set" as const;
const REMOVE = "identity.litellm-link.remove" as const;

// The path oid, read from the URL only to refuse a caller's own identity
// before any parsing (Rule 10.3); the validated value is parsed in the handler.
function pathOid(request: Request): string | null {
  const match = /\/api\/identities\/([^/]+)\/litellm-link\/?$/.exec(
    new URL(request.url).pathname,
  );
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

async function permit(request: Request, session: Session): Promise<boolean> {
  if (!(await permitAdminOrOrgAdmin(request, session))) return false;
  return pathOid(request) !== session.user.oid;
}

const denied = async (request: Request) => ({
  action: request.method === "DELETE" ? REMOVE : SET,
  pattern: PATTERN,
});

const oidOf = async (ctx: RouteContext) =>
  parseInput((await ctx.params).oid, IdParamSchema);

export const PUT = withRoute(
  async (request, ctx, session) => {
    const refused = openModeRefusal();
    if (refused) return refused;
    const oid = await oidOf(ctx);
    const body = await parseJsonBody(request, LiteLLMLinkPutBodySchema);
    if (!(await identityExists(oid))) return notFoundResponse();

    return liteLLMResponse(async () => {
      const target = await readLinkTarget(
        request,
        session,
        body.litellmUserId,
        SET,
        PATTERN,
      );
      if (!target.ok) return target.response;
      if (body.mode === "match") {
        const email = await ownEmail(oid);
        const same =
          email !== null &&
          matchLiteLLMUser(
            { oid, authMethod: "entra", email },
            {
              userId: body.litellmUserId,
              email: target.email,
              ssoUserId: null,
            },
            null,
            { storedEmail: true },
          ).email;
        if (!same) {
          return jsonError(
            409,
            "CONFLICT",
            "The LiteLLM user's email does not match the identity's email",
          );
        }
      }
      const result = await writeLiteLLMUserLink(
        {
          oid,
          version: body.version === 0 ? null : body.version,
          write: {
            kind: "set",
            litellmUserId: body.litellmUserId,
            mode: body.mode,
            ...(body.reason !== undefined ? { reason: body.reason } : {}),
          },
        },
        auditContext(session),
      );
      if (!result.ok) return accessErrorResponse(result.code);
      return jsonData(
        LiteLLMLinkResultSchema.parse({
          oid,
          litellmUserId: result.value.litellmUserId ?? null,
          version: result.value.version,
        }),
      );
    });
  },
  { permit, denied },
);

export const DELETE = withRoute(
  async (request, ctx, session) => {
    const refused = openModeRefusal();
    if (refused) return refused;
    const oid = await oidOf(ctx);
    const body = await parseJsonBody(request, LiteLLMLinkDeleteBodySchema);
    if (!(await identityExists(oid))) return notFoundResponse();
    const result = await writeLiteLLMUserLink(
      { oid, version: body.version, write: { kind: "remove" } },
      auditContext(session),
    );
    if (!result.ok) return accessErrorResponse(result.code);
    return jsonData(
      LiteLLMLinkResultSchema.parse({
        oid,
        litellmUserId: null,
        version: result.value.version,
      }),
    );
  },
  { permit, denied },
);
