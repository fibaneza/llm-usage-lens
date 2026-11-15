import { LiteLLMUserSearchResponseSchema } from "@llm-usage-lens/shared";

import {
  jsonData,
  jsonError,
  parseSearchParams,
  withRoute,
} from "@/lib/api/respond";
import { searchUsers } from "@/lib/litellm/operations";
import {
  UserSearchQuerySchema,
  enabledOperations,
  liteLLMResponse,
  requireEnabled,
  teamAccess,
} from "@/lib/litellm/read-views";
import { openModeRefusal } from "@/lib/litellm/route-guard";

// Source: docs/specs/2026-11-10-litellm.md - "Reads" (searchUsers: search 2-100
// characters, page_size <= 25; a Lead's search sends team=<linked team> once
// per team in scope), "Views by role (L3b)" (Scope), "API routes"
// (/api/litellm/users GET ?q=), LD22, LT21, Access Control - Enforcement
// item 2. Rows are filtered to the caller's teams after the call, so a proxy
// that ignores team= cannot widen the result.

export const dynamic = "force-dynamic";

export const GET = withRoute(async (request, _ctx, session) => {
  const refused = openModeRefusal();
  if (refused) return refused;
  const access = await teamAccess(session);
  if (!access.orgWide && !access.lead) {
    return jsonError(403, "FORBIDDEN", "Insufficient permission");
  }
  const query = parseSearchParams(request, UserSearchQuerySchema);
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;
  return liteLLMResponse(async () => {
    const enabled = await enabledOperations();
    requireEnabled(enabled, ["searchUsers"]);
    const byLiteLLMId = new Map(access.linked.map((t) => [t.litellmTeamId, t]));
    const scopes: Array<string | undefined> = access.orgWide
      ? [undefined]
      : access.linked.map((t) => t.litellmTeamId);
    const results = await Promise.all(
      scopes.map((litellmTeamId) =>
        searchUsers({
          search: query.q,
          page,
          pageSize,
          ...(litellmTeamId ? { litellmTeamId } : {}),
        }),
      ),
    );
    const merged = new Map<
      string,
      {
        userId: string;
        email: string;
        spend: number;
        maxBudget: number | null;
        teams: Map<string, { teamId: string; teamName: string }>;
      }
    >();
    for (const row of results.flatMap((r) => r.users)) {
      const teams = (row.teams ?? []).flatMap((id) => {
        const team = byLiteLLMId.get(id);
        return team ? [{ teamId: team.teamId, teamName: team.teamName }] : [];
      });
      if (!access.orgWide && teams.length === 0) continue;
      const entry = merged.get(row.user_id) ?? {
        userId: row.user_id,
        email: row.user_email ?? row.user_id,
        spend: row.spend ?? 0,
        maxBudget: row.max_budget ?? null,
        teams: new Map(),
      };
      for (const t of teams) entry.teams.set(t.teamId, t);
      merged.set(row.user_id, entry);
    }
    return jsonData(
      LiteLLMUserSearchResponseSchema.parse({
        users: [...merged.values()].map((u) => ({
          ...u,
          teams: [...u.teams.values()],
        })),
        page,
        pageSize,
        enabledOperations: enabled,
      }),
    );
  });
});
