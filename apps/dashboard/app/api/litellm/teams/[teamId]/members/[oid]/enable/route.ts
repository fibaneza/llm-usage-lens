import { memberWriteRoute, snapshot } from "@/lib/litellm/member-write";
import { enableMember } from "@/lib/litellm/operations";

// Source: docs/specs/2026-11-10-litellm.md - "Writes" (enableMember: Lead +
// Admin; /key/unblock once per key the member owns in that team),
// "Identity mapping and members" and LD2 (never deletes keys or data; not
// proxy-wide), LT5, LT9. The audit carries token ids, never key values.

export const dynamic = "force-dynamic";

export const POST = memberWriteRoute(
  {
    action: "litellm.member.enable",
    pattern: "/api/litellm/teams/[teamId]/members/[oid]/enable",
    toggle: "enableMember",
    status: 200,
    target: "existing",
    oidFrom: "path",
  },
  async ({ actor, litellmTeamId, oid, litellmUserId }) => {
    const { tokenIds } = await enableMember(
      { litellmTeamId, litellmUserId },
      { actor },
    );
    return {
      data: { oid, litellmUserId, tokenIds },
      after: snapshot({ litellmUserId, tokenIds }),
    };
  },
);
