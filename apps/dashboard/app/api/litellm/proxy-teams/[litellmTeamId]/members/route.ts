import { z } from "zod";

import { LiteLLMProxyTeamMembersResponseSchema } from "@llm-usage-lens/shared";

import {
  NOT_FOUND_MESSAGE,
  NotFoundError,
  jsonData,
  jsonError,
  parseInput,
  withRoute,
} from "@/lib/api/respond";
import { getIdentityRecord } from "@/lib/data/access/team-member-lookup";
import { getLiteLLMUserOwner } from "@/lib/data/access/identity-links";
import { LiteLLMError } from "@/lib/litellm/client";
import { PathLiteLLMId } from "@/lib/litellm/litellm-id-write";
import { getTeam } from "@/lib/litellm/operations";
import {
  enabledOperations,
  liteLLMResponse,
  reduceMembers,
  requireEnabled,
  teamAccess,
} from "@/lib/litellm/read-views";
import { openModeRefusal } from "@/lib/litellm/route-guard";
import { runBoundedSettled } from "@/lib/litellm/run-settled";

// Source: docs/specs/2026-11-10-litellm.md - "API routes" (GET
// /api/litellm/proxy-teams/[litellmTeamId]/members: Admin, org-admin, Auditor;
// a Lead 403; at most 200 members, LD34; shape agent decision 2026-11-23),
// LD19, LD23 (Organisation cap omits spend and budget), LT1/LT9 (loose rows
// reduced), LT5; Access Control - "Reset by LiteLLM ids".

export const dynamic = "force-dynamic";

const MAX_MEMBERS = 200;
const MAX_CONCURRENT_LOOKUPS = 10;

type Item = z.infer<
  typeof LiteLLMProxyTeamMembersResponseSchema
>["items"][number];

export const GET = withRoute(async (_request, { params }, session) => {
  const refused = openModeRefusal();
  if (refused) return refused;
  const access = await teamAccess(session);
  if (!access.orgWide) {
    return jsonError(403, "FORBIDDEN", "Insufficient permission");
  }
  const litellmTeamId = parseInput((await params).litellmTeamId, PathLiteLLMId);
  return liteLLMResponse(async () => {
    const enabled = await enabledOperations();
    requireEnabled(enabled, ["getTeam"]);
    const info = await getTeam({ litellmTeamId }).catch((error: unknown) => {
      if (error instanceof LiteLLMError && error.status === 404) {
        throw new NotFoundError(NOT_FOUND_MESSAGE);
      }
      throw error;
    });
    const emails = new Map(
      (info.team_info.members_with_roles ?? []).flatMap((m) =>
        m.user_id && m.user_email ? [[m.user_id, m.user_email] as const] : [],
      ),
    );
    const all = reduceMembers(info.team_memberships, emails);
    const truncated = all.length > MAX_MEMBERS;
    const rows = all.slice(0, MAX_MEMBERS);
    const items: Item[] = new Array<Item>(rows.length);
    await runBoundedSettled(
      rows.map((m, index) => ({ m, index })),
      MAX_CONCURRENT_LOOKUPS,
      async ({ m, index }) => {
        const oid = await getLiteLLMUserOwner(m.userId);
        const identity = oid ? await getIdentityRecord(oid) : null;
        items[index] = {
          userId: m.userId,
          email: m.email,
          ...(access.perUserCostHidden
            ? {}
            : { spend: m.spend, maxBudget: m.maxBudget }),
          person: oid
            ? { oid, name: identity?.displayName ?? identity?.email ?? m.email }
            : null,
        };
      },
    );
    return jsonData(
      LiteLLMProxyTeamMembersResponseSchema.parse({
        litellmTeamId,
        enabledOperations: enabled,
        ...(truncated ? { truncated: true } : {}),
        items,
      }),
    );
  });
});
