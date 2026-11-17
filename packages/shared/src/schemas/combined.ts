import { z } from "zod";

// Source: docs/specs/2026-11-10-litellm.md - "Combined usage and My usage
// (L6)": Visibility (show | warn | hidden; hidden is applied by the server
// and carries no figure), States (LD37: litellm and combined null), The
// computation (figures, reconciliation, estimate flags), Routes; LD38,
// LT29-LT32.

export const CombinedVisibilitySchema = z.enum(["show", "warn", "hidden"]);
export type CombinedVisibility = z.infer<typeof CombinedVisibilitySchema>;

// A hidden body carries the head only; the figure keys are typed as absent so
// a consumer can read them without narrowing and a body that carries one
// still fails parsing (LT29, LT32).
const noFigure = z.never().optional();
function hiddenFor<T extends z.ZodRawShape>(shape: T) {
  const absent = Object.fromEntries(
    Object.keys(shape).map((key) => [key, noFigure]),
  ) as { [K in keyof T]: typeof noFigure };
  return z.strictObject({
    visibility: z.literal("hidden"),
    configured: z.boolean(),
    gatewayConfigured: z.literal(false),
    ...absent,
  });
}

const money = z.number();
const moneyOrNull = z.number().nullable();

// show <-> the gateway is configured; warn <-> it is not.
const fullHead = {
  visibility: z.enum(["show", "warn"]),
  configured: z.boolean(),
  gatewayConfigured: z.boolean(),
};
const consistent = (v: { visibility: string; gatewayConfigured: boolean }) =>
  (v.visibility === "show") === v.gatewayConfigured;

export const CombinedOrganisationFigureSchema = z.object({
  bedrockExact: money,
  gatewaySlice: money,
  bedrockDirect: money,
  litellm: moneyOrNull,
  combined: moneyOrNull,
  byProvider: z.array(z.strictObject({ provider: z.string(), spend: money })),
  reconciliation: z
    .strictObject({
      litellmBedrock: money,
      difference: money,
      differencePct: moneyOrNull,
    })
    .nullable(),
  costEstimated: z.boolean(),
  provisional: z.boolean(),
});

const teamFigureShape = {
  teamId: z.string(),
  teamName: z.string(),
  bedrockDirect: money,
  gatewaySlice: money,
  litellm: moneyOrNull,
  combined: moneyOrNull,
  reason: z.literal("not-linked").optional(),
  costEstimated: z.boolean(),
  provisional: z.boolean(),
};
export const CombinedTeamFigureSchema = z.strictObject(teamFigureShape);

const personFigureShape = {
  bedrockDirect: money,
  litellm: moneyOrNull,
  litellmUser: z.boolean(),
  combined: moneyOrNull,
  costEstimated: z.literal(true),
  provisional: z.boolean(),
};
export const CombinedPersonFigureSchema = z.strictObject(personFigureShape);

export const CombinedOrganisationResponseSchema = z.union([
  hiddenFor(CombinedOrganisationFigureSchema.shape),
  z
    .strictObject({ ...fullHead, ...CombinedOrganisationFigureSchema.shape })
    .refine(consistent),
]);
const teamsShape = { teams: z.array(CombinedTeamFigureSchema) };
export const CombinedTeamsResponseSchema = z.union([
  hiddenFor(teamsShape),
  z.strictObject({ ...fullHead, ...teamsShape }).refine(consistent),
]);
export const CombinedTeamResponseSchema = z.union([
  hiddenFor(teamFigureShape),
  z.strictObject({ ...fullHead, ...teamFigureShape }).refine(consistent),
]);
export const CombinedMeResponseSchema = z.union([
  hiddenFor(personFigureShape),
  z.strictObject({ ...fullHead, ...personFigureShape }).refine(consistent),
]);

export type CombinedOrganisationFigure = z.infer<
  typeof CombinedOrganisationFigureSchema
>;
export type CombinedTeamFigure = z.infer<typeof CombinedTeamFigureSchema>;
export type CombinedPersonFigure = z.infer<typeof CombinedPersonFigureSchema>;
export type CombinedOrganisationResponse = z.infer<
  typeof CombinedOrganisationResponseSchema
>;
export type CombinedTeamsResponse = z.infer<typeof CombinedTeamsResponseSchema>;
export type CombinedTeamResponse = z.infer<typeof CombinedTeamResponseSchema>;
export type CombinedMeResponse = z.infer<typeof CombinedMeResponseSchema>;
