import {
  DirectoryPageSchema,
  DirectoryQuerySchema,
  USER_LINKS_PAGE_SIZE,
  runBounded,
} from "@llm-usage-lens/shared";
import type { DirectoryRow } from "@llm-usage-lens/shared";

import { accessErrorResponse, cursorSecret } from "@/lib/api/access-route";
import { loadManager } from "@/lib/api/matrix-route";
import { findPersonInvites } from "@/lib/api/person-invite";
import { jsonData, parseSearchParams, withRoute } from "@/lib/api/respond";
import { isMatrixWriter } from "@/lib/auth/write-policy";
import { getAffiliation } from "@/lib/data/access/affiliations";
import { listDirectory } from "@/lib/data/access/directory-rows";
import { searchIdentities } from "@/lib/data/access/identities";
import { getIdentityLink } from "@/lib/data/access/identity-links";
import { getIdentityRecord } from "@/lib/data/access/team-member-lookup";
import { listTeamDirectory } from "@/lib/api/team-directory";
import { isLiteLLMConfigured } from "@/lib/litellm/client";
import {
  litellmReadRefusal,
  liteLLMErrorResponse,
  openModeRefusal,
} from "@/lib/litellm/route-guard";
import { suggestLiteLLMUserByEmail } from "@/lib/manage/litellm-email-suggestion";

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
          truncated: false,
        },
      }
    : await listDirectory({
        sort: query.sort,
        dir: query.dir,
        cursorSecret: cursorSecret(),
        limit: USER_LINKS_PAGE_SIZE,
        teamNames:
          query.sort === "team"
            ? new Map(
                (await listTeamDirectory()).map(
                  (t) => [t.teamId, t.teamName] as const,
                ),
              )
            : new Map(),
        ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
      });
  if (!page.ok) return accessErrorResponse(page.code);

  // Placing a person by hand (T-IV5): state and invite for member writers only.
  const actor = await loadManager(session);
  const writer = actor !== null && isMatrixWriter(actor.roles);
  const items: DirectoryRow[] = await Promise.all(
    page.value.items.map(async (identity) => {
      const [link, affiliation] = await Promise.all([
        getIdentityLink(identity.oid),
        getAffiliation(identity.oid),
      ]);
      const invites = writer
        ? await findPersonInvites([
            identity.email,
            (await getIdentityRecord(identity.oid))?.upn,
          ])
        : [];
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
        ...(identity.createdAt ? { createdAt: identity.createdAt } : {}),
        lastSignInAt: identity.lastSignInAt ?? null,
        ...(writer
          ? invites.length > 0
            ? { state: "invited" as const, invites }
            : { state: "signed-in" as const }
          : {}),
      };
    }),
  );

  if (withMatch) {
    try {
      await runBounded(items, LOOKUP_CONCURRENCY, async (row) => {
        if (row.litellm.state !== "none") return;
        row.match = await suggestLiteLLMUserByEmail(row.email);
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
      truncated: page.value.truncated,
      ...(page.value.cursor ? { cursor: page.value.cursor } : {}),
    }),
  );
});
