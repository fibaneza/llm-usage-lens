import { z } from "zod";

import { Iso8601Schema } from "./schemas/primitives";

// Access Control spec — Threat model T4: a group mapping grants a scoped role
// only, never a global one; `member` applies to teams only.
const memberOnTeamOnly = (value: {
  scopedRole: string;
  target: { type: string };
}): boolean => value.scopedRole !== "member" || value.target.type === "team";
const memberOnTeamOnlyIssue = {
  message: "member applies to a team only",
  path: ["scopedRole"],
};

export const GroupMappingBaseSchema = z.object({
  groupId: z.string().min(1),
  target: z.object({
    type: z.enum(["team", "department"]),
    id: z.string().min(1),
  }),
  scopedRole: z.enum(["internal-team-admin", "member"]),
});

export const GroupMappingInputSchema = GroupMappingBaseSchema.refine(
  memberOnTeamOnly,
  memberOnTeamOnlyIssue,
);

export const GroupMappingSchema = GroupMappingBaseSchema.extend({
  version: z.number().int().min(0),
  updatedAt: Iso8601Schema,
}).refine(memberOnTeamOnly, memberOnTeamOnlyIssue);

export type GroupMappingInput = z.infer<typeof GroupMappingInputSchema>;
export type GroupMapping = z.infer<typeof GroupMappingSchema>;
