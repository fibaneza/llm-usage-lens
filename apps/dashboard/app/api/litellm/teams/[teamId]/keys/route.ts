import { LiteLLMKeysResponseSchema } from "@llm-usage-lens/shared";
import { z } from "zod";

import { IdParamSchema } from "@/lib/api/id-param";
import {
  NOT_FOUND_MESSAGE,
  NotFoundError,
  jsonData,
  parseInput,
  withRoute,
} from "@/lib/api/respond";
import {
  resolveLiteLLMUserId,
  emailsOf,
  snapshot,
} from "@/lib/litellm/member-write";
import {
  Duration,
  generateMemberKey,
  listKeys,
} from "@/lib/litellm/operations";
import {
  keyView,
  liteLLMResponse,
  reduceMembers,
  resolveLiteLLMTeam,
} from "@/lib/litellm/read-views";
import { openModeRefusal } from "@/lib/litellm/route-guard";
import {
  KeySettingsShape,
  assertNotPrivileged,
  checkKeySettings,
  defined,
  teamWriteRoute,
} from "@/lib/litellm/team-write";

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
        items: items.map((k) => {
          const { userId, ...rest } = keyView(k);
          return team.perUserCostHidden ? rest : { userId, ...rest };
        }),
      }),
    );
  });
});

// ---- POST: generateMemberKey ----------------------------------------------

// Source: docs/specs/2026-11-10-litellm.md - "Writes" (generateMemberKey: Lead
// + Admin; models <= team, limits <= member and team; the audit names the new
// token id with alias, models and limits, never the value), "Privileged
// targets are refused", "Budgets and limits", LT4, LT5, LT9, LT10, LT14, LT18.
// The key value is in this one response only; the audit, DynamoDB, logs and
// any later response never carry it.
const GenerateBodySchema = z.strictObject({
  oid: IdParamSchema,
  ...KeySettingsShape,
  duration: Duration.optional(),
});

export const POST = teamWriteRoute(
  {
    action: "litellm.key.generate",
    pattern: "/api/litellm/teams/[teamId]/keys",
    toggle: "generateMemberKey",
    status: 201,
    body: GenerateBodySchema,
  },
  async ({ actor, teamId, litellmTeamId, body, teamInfo }) => {
    const info = await teamInfo();
    const litellmUserId = await resolveLiteLLMUserId(body.oid);
    const member = litellmUserId
      ? reduceMembers(info.team_memberships, emailsOf(info)).find(
          (m) => m.userId === litellmUserId,
        )
      : undefined;
    if (!litellmUserId || !member) throw new NotFoundError(NOT_FOUND_MESSAGE);
    await assertNotPrivileged(litellmUserId);

    const { oid, ...settings } = body;
    await checkKeySettings(settings, info, litellmUserId);
    const given = defined(settings);
    const issued = await generateMemberKey(
      { litellmTeamId, litellmUserId, dashboardTeamId: teamId, ...given },
      { actor },
    );
    return {
      data: {
        tokenId: issued.tokenId,
        key: issued.key,
        oid,
        litellmUserId,
        ...given,
      },
      target: { type: "litellm-key", id: issued.tokenId },
      after: snapshot({ litellmUserId, ...given }),
    };
  },
);
