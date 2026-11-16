import { z } from "zod";

import {
  badRequest,
  memberWriteRoute,
  snapshot,
} from "@/lib/litellm/member-write";
import { Limit, setMemberLimits } from "@/lib/litellm/operations";

// Source: docs/specs/2026-11-10-litellm.md - "Writes" (setMemberLimits: Lead +
// Admin; POST /team/member_update with the limit fields only), "Budgets and
// limits" (limits are positive integers or unset - omitted, never 0; a member
// limit above the team's is 400 with no LiteLLM write), LT10, LT13.

export const dynamic = "force-dynamic";

const PositiveLimit = Limit.min(1);
const BodySchema = z
  .strictObject({
    rpmLimit: PositiveLimit.optional(),
    tpmLimit: PositiveLimit.optional(),
  })
  .refine((v) => v.rpmLimit !== undefined || v.tpmLimit !== undefined, {
    message: "Nothing to change",
  });

const above = (value: number | undefined, ceiling: number | null | undefined) =>
  value !== undefined &&
  ceiling !== null &&
  ceiling !== undefined &&
  value > ceiling;

export const PATCH = memberWriteRoute(
  {
    action: "litellm.member.limits",
    pattern: "/api/litellm/teams/[teamId]/members/[oid]/limits",
    toggle: "setMemberLimits",
    status: 200,
    target: "existing",
    oidFrom: "path",
    body: BodySchema,
  },
  async ({
    actor,
    litellmTeamId,
    oid,
    litellmUserId,
    body,
    teamInfo,
    member,
  }) => {
    const team = teamInfo.team_info;
    if (
      above(body.rpmLimit, team.rpm_limit) ||
      above(body.tpmLimit, team.tpm_limit)
    ) {
      throw badRequest("A member limit is above the team's limit");
    }
    const given = {
      ...(body.rpmLimit === undefined ? {} : { rpmLimit: body.rpmLimit }),
      ...(body.tpmLimit === undefined ? {} : { tpmLimit: body.tpmLimit }),
    };
    await setMemberLimits(
      { litellmTeamId, litellmUserId, ...given },
      { actor },
    );
    return {
      data: { oid, litellmUserId, ...given },
      before: snapshot({
        litellmUserId,
        rpmLimit: body.rpmLimit === undefined ? undefined : member?.rpmLimit,
        tpmLimit: body.tpmLimit === undefined ? undefined : member?.tpmLimit,
      }),
      after: snapshot({ litellmUserId, ...given }),
    };
  },
);
