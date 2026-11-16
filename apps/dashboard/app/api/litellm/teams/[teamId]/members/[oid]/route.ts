import { memberWriteRoute } from "@/lib/litellm/member-write";
import { removeTeamMember } from "@/lib/litellm/operations";

// Source: docs/specs/2026-11-10-litellm.md - "Writes" (removeTeamMember:
// Lead + Admin; POST /team/member_delete), "Identity mapping and members"
// (removing a dashboard membership never changes LiteLLM; this is the separate
// "also remove from LiteLLM" action), LT5.

export const dynamic = "force-dynamic";

export const DELETE = memberWriteRoute(
  {
    action: "litellm.member.remove",
    pattern: "/api/litellm/teams/[teamId]/members/[oid]",
    toggle: "removeTeamMember",
    status: 200,
    target: "existing",
    oidFrom: "path",
  },
  async ({ actor, litellmTeamId, oid, litellmUserId }) => {
    await removeTeamMember({ litellmTeamId, litellmUserId }, { actor });
    return { data: { oid, litellmUserId } };
  },
);
