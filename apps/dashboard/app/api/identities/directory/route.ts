import {
  DirectoryPageSchema,
  DirectoryQuerySchema,
  USER_LINKS_PAGE_SIZE,
  runBounded,
} from "@llm-usage-lens/shared";
import type { DirectoryRow } from "@llm-usage-lens/shared";
import { z } from "zod";

import { accessErrorResponse, cursorSecret } from "@/lib/api/access-route";
import { jsonData, parseSearchParams, withRoute } from "@/lib/api/respond";
import { getAffiliation } from "@/lib/data/access/affiliations";
import { listIdentities, searchIdentities } from "@/lib/data/access/identities";
import { getIdentityLink } from "@/lib/data/access/identity-links";
import { isLiteLLMConfigured } from "@/lib/litellm/client";
import { findUserByEmail } from "@/lib/litellm/operations";
import {
  litellmReadRefusal,
  liteLLMErrorResponse,
  openModeRefusal,
} from "@/lib/litellm/route-guard";

// Source: docs/specs/2026-11-10-access-control.md - "API routes (additions)"
// (/api/identities/directory: internal-admin, internal-org-admin,
// internal-auditor; 25 rows a page, opaque cursor; `?include=litellmMatch`
// adds `match` from findUserByEmail on unlinked rows, read only; management
// improvements D15, D16). Identity links are read per request, never cached
// (Rule 60.10).

export const dynamic = "force-dynamic";

const LOOKUP_CONCURRENCY = 5;
const SEARCH_LIMIT = 10;

// ST1 D-ST2: `q` is a case-insensitive substring of name, email or UPN
// across every page; at most 10 results, no cursor.

export const GET = withRoute(async (request, _ctx, session) => {
  const forbidden = await litellmReadRefusal(session);
  if (forbidden) return forbidden;
  const query = parseSearchParams(request, DirectoryQuerySchema);
  // LD37: not configured is a handled state, so rows come back without match.
  const withMatch =
    query.include === "litellmMatch" && (await isLiteLLMConfigured());
  if (withMatch) {
    const refused = openModeRefusal();
    if (refused) return refused;
  }

  const page = query.q
    ? {
        ok: true as const,
        value: {
          items: await searchIdentities(query.q, SEARCH_LIMIT),
          cursor: undefined,
        },
      }
    : await listIdentities({
        cursorSecret: cursorSecret(),
        limit: USER_LINKS_PAGE_SIZE,
        ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
      });
  if (!page.ok) return accessErrorResponse(page.code);

  const items: DirectoryRow[] = await Promise.all(
    page.value.items.map(async (identity) => {
      const [link, affiliation] = await Promise.all([
        getIdentityLink(identity.oid),
        getAffiliation(identity.oid),
      ]);
      return {
        oid: identity.oid,
        displayName: identity.displayName ?? null,
        email: identity.email ?? null,
        authMethod: identity.authMethod,
        memberTeamId: affiliation?.teamId ?? null,
        litellm: link?.litellmUserId
          ? { state: "linked" as const, litellmUserId: link.litellmUserId }
          : { state: "none" as const },
        linkVersion: link?.version ?? 0,
      };
    }),
  );

  if (withMatch) {
    try {
      await runBounded(items, LOOKUP_CONCURRENCY, async (row) => {
        const email = row.email?.trim().toLowerCase();
        if (row.litellm.state !== "none") return;
        if (!email) {
          row.match = null;
          return;
        }
        if (!z.email().safeParse(email).success) {
          row.match = null;
          return;
        }
        const { users } = await findUserByEmail({ email });
        const found = users.find((u) => u.user_email?.toLowerCase() === email);
        row.match = found ? { litellmUserId: found.user_id, email } : null;
      });
    } catch (error) {
      const response = liteLLMErrorResponse(error);
      if (response) return response;
      throw error;
    }
  }

  return jsonData(
    DirectoryPageSchema.parse({
      items,
      ...(page.value.cursor ? { cursor: page.value.cursor } : {}),
    }),
  );
});
