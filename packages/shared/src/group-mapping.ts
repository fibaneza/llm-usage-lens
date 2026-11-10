import { z } from "zod";

// Access Control spec — Threat model T4: a group mapping grants a scoped role
// only, never a global one; `member` applies to teams only.
export const GroupMappingInputSchema = z
  .object({
    groupId: z.string().min(1),
    target: z.object({
      type: z.enum(["team", "department"]),
      id: z.string().min(1),
    }),
    scopedRole: z.enum(["internal-team-admin", "member"]),
  })
  .refine(
    (value) => value.scopedRole !== "member" || value.target.type === "team",
    { message: "member applies to a team only", path: ["scopedRole"] },
  );

export type GroupMappingInput = z.infer<typeof GroupMappingInputSchema>;
