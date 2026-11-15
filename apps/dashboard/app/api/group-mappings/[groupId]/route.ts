import {
  GroupMappingInputSchema,
  GroupMappingSchema,
} from "@llm-usage-lens/shared";
import { z } from "zod";

import {
  GroupIdSchema,
  accessErrorResponse,
  auditContext,
} from "@/lib/api/access-route";
import {
  BadRequestError,
  jsonData,
  parseInput,
  parseJsonBody,
  withRoute,
} from "@/lib/api/respond";
import {
  deleteGroupMapping,
  updateGroupMapping,
} from "@/lib/data/access/group-mappings";

// Source: docs/specs/2026-11-10-access-control.md - "API routes (additions)"
// (PATCH, DELETE internal-admin), "Enforcement" item 6 (version -> 409; a body
// id must equal the path id -> 400).
const VersionSchema = z.object({ version: z.number().int().min(1) });
const PatchSchema = GroupMappingInputSchema.and(VersionSchema);
const PATTERN = "/api/group-mappings/[groupId]";

const patchHandler = withRoute(
  async (request, ctx, session) => {
    const groupId = parseInput((await ctx.params).groupId, GroupIdSchema);
    const body = await parseJsonBody(request, PatchSchema);
    if (body.groupId !== groupId) {
      throw new BadRequestError([
        {
          code: "custom",
          message: "Body groupId must equal the path groupId",
          path: ["groupId"],
          input: undefined,
        },
      ]);
    }
    const result = await updateGroupMapping(body, auditContext(session));
    if (!result.ok) return accessErrorResponse(result.code);
    return jsonData(GroupMappingSchema.parse(result.value));
  },
  {
    requireAdmin: true,
    denied: { action: "groupmap.update", pattern: PATTERN },
  },
);

const deleteHandler = withRoute(
  async (request, ctx, session) => {
    const groupId = parseInput((await ctx.params).groupId, GroupIdSchema);
    const { version } = await parseJsonBody(request, VersionSchema);
    const result = await deleteGroupMapping(
      { groupId, version },
      auditContext(session),
    );
    if (!result.ok) return accessErrorResponse(result.code);
    return jsonData({ groupId });
  },
  {
    requireAdmin: true,
    denied: { action: "groupmap.delete", pattern: PATTERN },
  },
);

type GroupContext = { params: Promise<{ groupId: string }> };

export const PATCH = (request: Request, ctx: GroupContext) =>
  patchHandler(request, ctx);
export const DELETE = (request: Request, ctx: GroupContext) =>
  deleteHandler(request, ctx);
