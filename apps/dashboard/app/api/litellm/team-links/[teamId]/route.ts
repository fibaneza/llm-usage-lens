import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  NOT_FOUND_MESSAGE,
  jsonData,
  jsonError,
  parseInput,
  parseJsonBody,
  withRoute,
} from "@/lib/api/respond";
import type { RouteContext } from "@/lib/api/respond";
import { getAllAccounts } from "@/lib/data/account-meta";
import {
  deleteTeamLink,
  getTeamLink,
  putTeamLink,
} from "@/lib/data/litellm/team-links";
import { isValidLiteLLMId } from "@/lib/litellm/allowlist";
import { LiteLLMError } from "@/lib/litellm/client";
import { confirmTeamExists } from "@/lib/litellm/operations";
import {
  adminOrAuditorRefusal,
  liteLLMErrorResponse,
  openModeRefusal,
} from "@/lib/litellm/route-guard";

// Source: docs/specs/2026-11-10-litellm.md — "API routes"
// (/api/litellm/team-links/[teamId]: GET Admin + Auditor, writes Admin),
// "Writes" (`linkTeam` / `unlinkTeam` are dashboard-only, Admin, audited, and
// read `/team/info` to confirm the team exists), "Data model additions" (a
// link and its claim in one transaction with the audit item), "Identity
// mapping" (one-to-one in v1). Upstream bodies are never echoed.

export const dynamic = "force-dynamic";

const ParamsSchema = z.object({
  teamId: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9._-]+$/),
});
const PutBodySchema = z.strictObject({
  litellmTeamId: z.string().refine(isValidLiteLLMId, "Invalid LiteLLM team id"),
  version: z.number().int().min(1).nullable(),
});

const teamIdOf = async (ctx: RouteContext) =>
  parseInput(await ctx.params, ParamsSchema).teamId;

const auditContext = (actor: string) => ({
  actor,
  requestId: randomUUID(),
  now: new Date(),
  sequence: { next: 0 },
});

const notFound = () => jsonError(404, "NOT_FOUND", NOT_FOUND_MESSAGE);

export const GET = withRoute(async (_request, ctx, session) => {
  const refused = openModeRefusal() ?? adminOrAuditorRefusal(session);
  if (refused) return refused;
  const link = await getTeamLink(await teamIdOf(ctx));
  return link ? jsonData(link) : notFound();
});

export const PUT = withRoute(
  async (request, ctx, session) => {
    const refused = openModeRefusal();
    if (refused) return refused;
    const teamId = await teamIdOf(ctx);
    const input = await parseJsonBody(request, PutBodySchema);
    const known = (await getAllAccounts()).some((a) => a.teamId === teamId);
    if (!known) return notFound();

    try {
      await confirmTeamExists({ litellmTeamId: input.litellmTeamId });
    } catch (error) {
      if (
        error instanceof LiteLLMError &&
        error.detail === "upstream_error" &&
        (error.status === 404 || error.status === 400)
      ) {
        return jsonError(400, "BAD_REQUEST", "LiteLLM does not know that team");
      }
      const response = liteLLMErrorResponse(error);
      if (response) return response;
      throw error;
    }

    const saved = await putTeamLink(
      { teamId, ...input },
      auditContext(session.user.oid),
    );
    if (!saved.ok) {
      return jsonError(409, "CONFLICT", "The link was changed or is in use");
    }
    return jsonData(saved.value);
  },
  {
    requireAdmin: true,
    denied: {
      action: "litellm.teamlink.link",
      pattern: "/api/litellm/team-links/[teamId]",
    },
  },
);

export const DELETE = withRoute(
  async (_request, ctx, session) => {
    const refused = openModeRefusal();
    if (refused) return refused;
    const removed = await deleteTeamLink(
      await teamIdOf(ctx),
      auditContext(session.user.oid),
    );
    if (!removed.ok) {
      return removed.code === "NOT_FOUND"
        ? notFound()
        : jsonError(409, "CONFLICT", "The link was changed; reload");
    }
    return jsonData(removed.value);
  },
  {
    requireAdmin: true,
    denied: {
      action: "litellm.teamlink.unlink",
      pattern: "/api/litellm/team-links/[teamId]",
    },
  },
);
