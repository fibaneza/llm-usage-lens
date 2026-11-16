import { z } from "zod";

import { NOT_FOUND_MESSAGE, NotFoundError } from "@/lib/api/respond";
import { snapshot } from "@/lib/litellm/member-write";
import { deleteKey, updateMemberKey } from "@/lib/litellm/operations";
import {
  KeySettingsShape,
  NOTHING_TO_CHANGE,
  assertNotPrivileged,
  atLeastOneField,
  checkKeySettings,
  confirmKey,
  defined,
  teamWriteRoute,
} from "@/lib/litellm/team-write";

// Source: docs/specs/2026-11-10-litellm.md - "Writes" (updateMemberKey: POST
// /key/update with the token and the fields given; Lead + Admin; audit token
// id before/after. deleteKey: exactly one token per call, Lead + Admin, off
// by default, LD10), "Resolution" (a token is accepted only after /key/info
// confirms its team_id), "Privileged targets" (updateMemberKey), "Budgets and
// limits", LT4, LT5, LT10, LT14, LT18.

export const dynamic = "force-dynamic";

const PATTERN = "/api/litellm/teams/[teamId]/keys/[tokenId]";

const PatchBodySchema = z
  .strictObject(KeySettingsShape)
  .refine(atLeastOneField, NOTHING_TO_CHANGE);

export const PATCH = teamWriteRoute(
  {
    action: "litellm.key.update",
    pattern: PATTERN,
    toggle: "updateMemberKey",
    status: 200,
    token: true,
    body: PatchBodySchema,
  },
  async ({ actor, litellmTeamId, tokenId, body, teamInfo }) => {
    const row = await confirmKey(tokenId, litellmTeamId);
    if (!row.user_id) throw new NotFoundError(NOT_FOUND_MESSAGE);
    await assertNotPrivileged(row.user_id);
    await checkKeySettings(body, await teamInfo(), row.user_id);
    const given = defined(body);
    await updateMemberKey({ tokenId, ...given }, { actor });
    const current = {
      keyAlias: row.key_alias,
      models: row.models,
      maxBudget: row.max_budget,
      budgetDuration: row.budget_duration,
      rpmLimit: row.rpm_limit,
      tpmLimit: row.tpm_limit,
      maxParallelRequests: row.max_parallel_requests,
    };
    const changed = Object.keys(given) as Array<keyof typeof current>;
    return {
      data: { tokenId, ...given },
      target: { type: "litellm-key", id: tokenId },
      before: snapshot(Object.fromEntries(changed.map((k) => [k, current[k]]))),
      after: snapshot(given),
    };
  },
);

export const DELETE = teamWriteRoute(
  {
    action: "litellm.key.delete",
    pattern: PATTERN,
    toggle: "deleteKey",
    status: 200,
    token: true,
  },
  async ({ actor, litellmTeamId, tokenId }) => {
    await confirmKey(tokenId, litellmTeamId);
    await deleteKey({ tokenId }, { actor });
    return {
      data: { tokenId, deleted: true },
      target: { type: "litellm-key", id: tokenId },
    };
  },
);
