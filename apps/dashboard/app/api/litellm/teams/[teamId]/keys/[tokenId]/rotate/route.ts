import { z } from "zod";

import { NOT_FOUND_MESSAGE, NotFoundError } from "@/lib/api/respond";
import { Duration, rotateKey } from "@/lib/litellm/operations";
import {
  assertNotPrivileged,
  confirmKey,
  teamWriteRoute,
} from "@/lib/litellm/team-write";

// Source: docs/specs/2026-11-10-litellm.md - "Writes" (rotateKey: OSS issues a
// new key with the old key's models and limits and blocks the old one,
// Enterprise regenerates in place with exactly { grace_period }; Lead +
// Admin; audit the old and the new token ids), "Privileged targets",
// "Resolution", LT4, LT5, LT9, LT14, LT18. The new value is in this one
// response only.

export const dynamic = "force-dynamic";

const BodySchema = z.strictObject({ gracePeriod: Duration.optional() });

export const POST = teamWriteRoute(
  {
    action: "litellm.key.rotate",
    pattern: "/api/litellm/teams/[teamId]/keys/[tokenId]/rotate",
    toggle: "rotateKey",
    status: 200,
    token: true,
    body: BodySchema,
  },
  async ({ actor, teamId, litellmTeamId, tokenId, body }) => {
    const row = await confirmKey(tokenId, litellmTeamId);
    if (!row.user_id) throw new NotFoundError(NOT_FOUND_MESSAGE);
    await assertNotPrivileged(row.user_id);
    const issued = await rotateKey(
      {
        tokenId,
        litellmTeamId,
        litellmUserId: row.user_id,
        dashboardTeamId: teamId,
        ...(body.gracePeriod === undefined
          ? {}
          : { gracePeriod: body.gracePeriod }),
      },
      { actor },
    );
    return {
      data: {
        tokenId: issued.tokenId,
        previousTokenId: tokenId,
        key: issued.key,
      },
      target: { type: "litellm-key", id: tokenId },
      before: { tokenIds: [tokenId] },
      after: { tokenIds: [issued.tokenId] },
    };
  },
);
