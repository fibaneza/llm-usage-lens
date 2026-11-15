import { DateRangeQuerySchema } from "@llm-usage-lens/shared";
import { z } from "zod";

import { jsonData, parseSearchParams, withRoute } from "@/lib/api/respond";
import { getIdentityLink } from "@/lib/data/access/identity-links";
import {
  findUserByEmail,
  getUser,
  getUserDailySpend,
} from "@/lib/litellm/operations";
import { openModeRefusal } from "@/lib/litellm/route-guard";
import {
  enabledOperations,
  keyView,
  liteLLMResponse,
  reduceDaily,
  requireEnabled,
  viewableTeams,
} from "@/lib/litellm/read-views";

// Source: docs/specs/2026-11-10-litellm.md — "API routes" (/api/litellm/me,
// any signed-in role, own data), "Roles and rights" (Viewer: through the
// litellmUserId link, empty state if unlinked; own keys' metadata, never key
// values), "Reads" (getUser: user_id from the link only, keys filtered to the
// caller's scope; getUserDailySpend timezone=0, LD20). `teams` lists the
// teams the caller may open as Lead, Admin or Auditor.

const EmailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const dynamic = "force-dynamic";

export const GET = withRoute(async (request, _ctx, session) => {
  const refused = openModeRefusal();
  if (refused) return refused;
  const { dateFrom, dateTo } = parseSearchParams(request, DateRangeQuerySchema);
  const [link, enabled, { teams, linkedLiteLLMTeamIds }] = await Promise.all([
    getIdentityLink(session.user.oid),
    enabledOperations(),
    viewableTeams(session),
  ]);
  return liteLLMResponse(async () => {
    // Without a stored link the session email resolves the user, read only
    // (Views by role - Own usage); LiteLLM's user_id is used as returned.
    let litellmUserId = link?.litellmUserId;
    // An email the gateway would refuse is treated as no match, not an error.
    const parsedEmail = EmailSchema.safeParse(session.user.email);
    const email = parsedEmail.success ? parsedEmail.data : undefined;
    if (!litellmUserId && email && enabled.includes("findUserByEmail")) {
      const found = await findUserByEmail({ email });
      litellmUserId = found.users.find(
        (u) => u.user_email?.toLowerCase() === email,
      )?.user_id;
    }
    if (!litellmUserId) {
      return jsonData({ linked: false, teams, enabledOperations: enabled });
    }
    requireEnabled(enabled, ["getUser", "getUserDailySpend"]);
    const [info, daily] = await Promise.all([
      getUser({ litellmUserId }),
      getUserDailySpend({
        litellmUserId,
        startDate: dateFrom,
        endDate: dateTo,
      }),
    ]);
    const self = litellmUserId.toLowerCase();
    const keys = info.keys.filter(
      (k) =>
        k.user_id?.toLowerCase() === self &&
        (k.team_id == null || linkedLiteLLMTeamIds.has(k.team_id)),
    );
    return jsonData({
      linked: true,
      spend: info.user_info?.spend ?? 0,
      maxBudget: info.user_info?.max_budget ?? null,
      daily: reduceDaily(daily.results),
      keys: keys.map(keyView),
      teams,
      enabledOperations: enabled,
    });
  });
});
