import { memberWriteRoute, snapshot } from "@/lib/litellm/member-write";
import { resetMemberSpend } from "@/lib/litellm/operations";

// Source: docs/specs/2026-11-10-litellm.md - "Writes" (resetMemberSpend: Lead +
// Admin; toggle default off, LD10; acts on exactly one member of one team),
// "Budgets and limits".

export const dynamic = "force-dynamic";

export const POST = memberWriteRoute(
  {
    action: "litellm.member.reset-spend",
    pattern: "/api/litellm/teams/[teamId]/members/[oid]/reset-spend",
    toggle: "resetMemberSpend",
    status: 200,
    target: "existing",
    oidFrom: "path",
  },
  async ({ actor, litellmTeamId, oid, litellmUserId, member }) => {
    await resetMemberSpend({ litellmTeamId, litellmUserId }, { actor });
    return {
      data: { oid, litellmUserId },
      before: snapshot({ litellmUserId, spend: member?.spend }),
      after: snapshot({ litellmUserId, spend: 0 }),
    };
  },
);
