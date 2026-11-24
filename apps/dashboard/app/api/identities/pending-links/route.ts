import {
  PendingLinkDeleteBodySchema,
  PendingLinkRemovedSchema,
  PendingLinksPageSchema,
} from "@llm-usage-lens/shared";
import { randomUUID } from "node:crypto";

import {
  accessErrorResponse,
  auditContext,
  listOptions,
} from "@/lib/api/access-route";
import { jsonData, parseJsonBody, withRoute } from "@/lib/api/respond";
import { getLiteLLMUserOwner } from "@/lib/data/access/identity-links";
import { SSO_KEY_PREFIX } from "@/lib/data/access/litellm-match";
import {
  getPendingLiteLLMLink,
  listPendingLiteLLMLinksPage,
  removePendingLiteLLMLink,
} from "@/lib/data/access/pending-litellm-links";
import {
  litellmReadRefusal,
  permitAdminOrOrgAdmin,
} from "@/lib/litellm/route-guard";

// Source: docs/specs/2026-11-10-access-control.md - "API routes (additions)"
// (`/api/identities/pending-links`: GET for `internal-admin`,
// `internal-org-admin` and `internal-auditor`, 25 rows a page, opaque cursor;
// DELETE `{ email, version }` or `{ litellmUserId, version }` for `internal-admin` and `internal-org-admin`,
// `403` before parsing, removes the pending link and releases its claim,
// audited `identity.litellm-pending.remove`), "Permission matrix", T-SY9,
// T-SY10, T-SY11. Neither method calls LiteLLM (it reads and removes the
// dashboard's own placeholder only).

export const dynamic = "force-dynamic";

const PATH = "/api/identities/pending-links";
const PAGE_SIZE = 25;

export const GET = withRoute(async (request, _ctx, session) => {
  const refused = await litellmReadRefusal(session);
  if (refused) return refused;
  const result = await listPendingLiteLLMLinksPage({
    ...listOptions(request),
    limit: PAGE_SIZE,
  });
  if (!result.ok) return accessErrorResponse(result.code);
  return jsonData(
    PendingLinksPageSchema.parse({
      items: result.value.items.map((link) => ({
        ...(link.emailOrOid.startsWith(SSO_KEY_PREFIX)
          ? {}
          : { email: link.emailOrOid }),
        litellmUserId: link.litellmUserId,
        version: link.version,
        createdAt: link.createdAt,
      })),
      ...(result.value.cursor ? { cursor: result.value.cursor } : {}),
    }),
  );
});

export const DELETE = withRoute(
  async (request, _ctx, session) => {
    const body = await parseJsonBody(request, PendingLinkDeleteBodySchema);
    let key: string;
    if ("email" in body) {
      key = body.email.toLowerCase();
      if (key.startsWith(SSO_KEY_PREFIX))
        return accessErrorResponse("NOT_FOUND");
    } else {
      const owner = await getLiteLLMUserOwner(body.litellmUserId);
      const pending = owner ? await getPendingLiteLLMLink(owner) : null;
      if (!pending || pending.litellmUserId !== body.litellmUserId) {
        return accessErrorResponse("NOT_FOUND");
      }
      key = pending.emailOrOid;
    }
    const result = await removePendingLiteLLMLink(
      { emailOrOid: key, version: body.version, runId: randomUUID() },
      auditContext(session),
    );
    if (!result.ok) return accessErrorResponse(result.code);
    return jsonData(
      PendingLinkRemovedSchema.parse(
        "email" in body
          ? { email: key }
          : { litellmUserId: body.litellmUserId },
      ),
    );
  },
  {
    permit: permitAdminOrOrgAdmin,
    denied: { action: "identity.litellm-pending.remove", pattern: PATH },
  },
);
