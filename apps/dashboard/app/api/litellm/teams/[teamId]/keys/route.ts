import { LiteLLMKeysResponseSchema } from "@llm-usage-lens/shared";

import { IdParamSchema } from "@/lib/api/id-param";
import { jsonData, parseInput, withRoute } from "@/lib/api/respond";
import { listKeys } from "@/lib/litellm/operations";
import {
  keyView,
  liteLLMResponse,
  resolveLiteLLMTeam,
} from "@/lib/litellm/read-views";
import { openModeRefusal } from "@/lib/litellm/route-guard";

// Source: docs/specs/2026-11-10-litellm.md — "API routes" (/api/litellm/teams/
// [teamId]/keys GET in scope), "Roles and rights" (keys' metadata, never key
// values), "Reads" (listKeys: team_id required, return_full_object, size <=
// 100; rows filtered to the caller's scope), threats LT1, LT9.

export const dynamic = "force-dynamic";

const KEY_PAGE_SIZE = 100;
// A bound on the paging loop: 1000 keys per team.
const MAX_KEY_PAGES = 10;

export const GET = withRoute(async (_request, { params }, session) => {
  const refused = openModeRefusal();
  if (refused) return refused;
  const teamId = parseInput((await params).teamId, IdParamSchema);
  const team = await resolveLiteLLMTeam(session, teamId);
  const { litellmTeamId } = team;
  if (litellmTeamId === null) return jsonData({ connected: false, items: [] });
  return liteLLMResponse(async () => {
    const items = [];
    for (let page = 1; page <= MAX_KEY_PAGES; page += 1) {
      const res = await listKeys({
        litellmTeamId,
        page,
        size: KEY_PAGE_SIZE,
      });
      items.push(...res.keys.filter((k) => k.team_id === litellmTeamId));
      if (page >= (res.total_pages ?? 1)) break;
    }
    return jsonData(
      LiteLLMKeysResponseSchema.parse({
        connected: true,
        items: items.map(keyView),
      }),
    );
  });
});
