import { blockKey } from "@/lib/litellm/operations";
import { confirmKey, teamWriteRoute } from "@/lib/litellm/team-write";

// Source: docs/specs/2026-11-10-litellm.md - "Writes" (blockKey: POST /key/block
// with the token hash only; Lead + Admin; audit the token id), "Resolution"
// (team confirmation), LT5.

export const dynamic = "force-dynamic";

export const POST = teamWriteRoute(
  {
    action: "litellm.key.block",
    pattern: "/api/litellm/teams/[teamId]/keys/[tokenId]/block",
    toggle: "blockKey",
    status: 200,
    token: true,
  },
  async ({ actor, litellmTeamId, tokenId }) => {
    await confirmKey(tokenId, litellmTeamId);
    await blockKey({ tokenId }, { actor });
    return {
      data: { tokenId, blocked: true },
      target: { type: "litellm-key", id: tokenId },
    };
  },
);
