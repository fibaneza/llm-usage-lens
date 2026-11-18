import { z } from "zod";

import { OrgUnitsSchema } from "./access-control";
import { Iso8601Schema } from "./primitives";

// Source: docs/specs/2026-05-15-data-model.md — "Entity: AppTeam";
// docs/specs/2026-11-10-access-control.md — "Created app teams" (T-MI3).
export const APP_TEAM_ID_PREFIX = "appteam-";

export const AppTeamIdSchema = z
  .string()
  .regex(
    /^appteam-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );

export const AppTeamNameSchema = z.string().trim().min(1).max(80);

export const AppTeamSchema = z.object({
  teamId: AppTeamIdSchema,
  name: AppTeamNameSchema,
  departmentId: z.string().min(1),
  departmentName: z.string().min(1),
  createdBy: z.string().min(1),
  createdAt: Iso8601Schema,
  version: z.number().int().min(1),
});

// Strict: a body `teamId` is a 400, never used (the id is server-generated).
export const CreateAppTeamInputSchema = z.strictObject({
  name: AppTeamNameSchema,
  departmentId: z.string().trim().min(1).max(128),
});

export const CreateAppTeamResponseSchema = AppTeamSchema;

export const OrgUnitTeamSchema = OrgUnitsSchema.shape.teams.element.extend({
  hasAwsAccount: z.boolean(),
});

export const OrgUnitsResponseSchema = OrgUnitsSchema.extend({
  teams: z.array(OrgUnitTeamSchema),
});

export const appTeamNameKey = (name: string): string =>
  name.trim().toLowerCase();

export const isReservedTeamId = (id: string): boolean =>
  id.startsWith(APP_TEAM_ID_PREFIX);

export type AppTeam = z.infer<typeof AppTeamSchema>;
export type CreateAppTeamInput = z.infer<typeof CreateAppTeamInputSchema>;
export type OrgUnitsResponse = z.infer<typeof OrgUnitsResponseSchema>;
