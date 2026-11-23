import { z } from "zod";

// Source: docs/specs/2026-11-10-access-control.md - "LiteLLM user links"
// (management improvements D16, 2026-11-17) and "API routes (additions)";
// docs/specs/2026-11-10-litellm.md - `createUser`, `searchUsers`, "Views as
// Management routes" (D16a). Rule 20.11: shapes validated on both ends.

export const USER_LINKS_PAGE_SIZE = 25;
export const LINK_REASON_MAX = 280;

const LiteLLMIdSchema = z.string().min(1).max(256);

// ---- GET /api/identities/directory -----------------------------------------

export const DirectoryLiteLLMLinkSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("linked"), litellmUserId: LiteLLMIdSchema }),
  z.object({ state: z.literal("none") }),
]);

// `match` is present only with ?include=litellmMatch, and only on an unlinked
// row: the LiteLLM user whose email equals the identity's verified email
// (read only, nothing is written; D27). `null` means the lookup found none.
export const DirectoryMatchSchema = z
  .object({ litellmUserId: LiteLLMIdSchema, email: z.string() })
  .nullable();

export const DirectoryRowSchema = z.object({
  oid: z.string().min(1),
  displayName: z.string().nullable(),
  email: z.string().nullable(),
  authMethod: z.enum(["entra", "master", "local", "password"]),
  memberTeamId: z.string().nullable(),
  litellm: DirectoryLiteLLMLinkSchema,
  // The IdentityLink version the link writes must send (0: no link yet).
  linkVersion: z.number().int().min(0),
  match: DirectoryMatchSchema.optional(),
});

export const DirectoryPageSchema = z.object({
  items: z.array(DirectoryRowSchema).max(USER_LINKS_PAGE_SIZE),
  cursor: z.string().optional(),
});

export const DirectoryQuerySchema = z.object({
  cursor: z.string().min(1).max(2048).optional(),
  include: z.literal("litellmMatch").optional(),
  q: z.string().trim().min(1).max(100).optional(),
});

// ---- PUT / DELETE /api/identities/[oid]/litellm-link ------------------------

export const LiteLLMLinkModeSchema = z.enum(["match", "manual"]);

export const LiteLLMLinkPutBodySchema = z
  .strictObject({
    litellmUserId: LiteLLMIdSchema,
    mode: LiteLLMLinkModeSchema,
    reason: z.string().trim().min(1).max(LINK_REASON_MAX).optional(),
    version: z.number().int().min(0),
  })
  .refine((b) => b.mode !== "manual" || b.reason !== undefined, {
    message: "A manual link needs a reason of 1 to 280 characters",
    path: ["reason"],
  });

export const LiteLLMLinkDeleteBodySchema = z.strictObject({
  version: z.number().int().min(1),
});

export const LiteLLMLinkResultSchema = z.object({
  oid: z.string().min(1),
  litellmUserId: LiteLLMIdSchema.nullable(),
  version: z.number().int().min(0),
});

// ---- POST /api/litellm/users ------------------------------------------------

export const CreateLiteLLMUserBodySchema = z.strictObject({
  oid: z.string().min(1).max(256),
});

export const CreateLiteLLMUserResultSchema = z.object({
  oid: z.string().min(1),
  litellmUserId: LiteLLMIdSchema,
  created: z.boolean(),
  version: z.number().int().min(1),
});

// ---- GET /api/litellm/users (the LiteLLM users tab, D16a) --------------------

// linked: an app user with the stored link. match: an app user with no link
// whose email equals a LiteLLM user's. none: an app user with no LiteLLM user
// ("not in LiteLLM", never a $0 row). unlinked: a LiteLLM user no app user
// claims (every all-users row without a claim; an orphaned LiteLLM member).
export const UserLinkStateSchema = z.enum([
  "linked",
  "match",
  "none",
  "unlinked",
]);

export const UsersListLiteLLMUserSchema = z.object({
  userId: z.string(),
  email: z.string(),
  // Absent while the Organisation cap hides per-user cost (LD23).
  spend: z.number().optional(),
  maxBudget: z.number().nullable().optional(),
  teams: z.array(z.object({ teamId: z.string(), teamName: z.string() })),
});

export const UsersListRowSchema = z.object({
  key: z.string().min(1),
  linkState: UserLinkStateSchema,
  appUser: z
    .object({
      oid: z.string(),
      displayName: z.string().nullable(),
      email: z.string().nullable(),
      version: z.number().int().min(0),
    })
    .nullable(),
  // null: the person is not in LiteLLM (linkState "none").
  litellmUser: UsersListLiteLLMUserSchema.nullable(),
});

export const UsersListResponseSchema = z.object({
  users: z.array(UsersListRowSchema).max(USER_LINKS_PAGE_SIZE),
  page: z.number(),
  pageSize: z.number(),
  // All-users mode: another page may exist. Team mode: the app team's
  // member count, which the pages cut at 25.
  hasMore: z.boolean(),
  total: z.number().int().min(0).optional(),
  enabledOperations: z.array(z.string()),
  // Server-computed per request from the caller's effective roles (claims plus
  // stored role grants); absent reads as false (fail closed).
  mayLink: z.boolean().default(false),
});

export type DirectoryRow = z.infer<typeof DirectoryRowSchema>;
export type DirectoryPage = z.infer<typeof DirectoryPageSchema>;
export type LiteLLMLinkPutBody = z.infer<typeof LiteLLMLinkPutBodySchema>;
export type LiteLLMLinkResult = z.infer<typeof LiteLLMLinkResultSchema>;
export type CreateLiteLLMUserResult = z.infer<
  typeof CreateLiteLLMUserResultSchema
>;
export type UserLinkState = z.infer<typeof UserLinkStateSchema>;
export type UsersListRow = z.infer<typeof UsersListRowSchema>;
export type UsersListResponse = z.infer<typeof UsersListResponseSchema>;
