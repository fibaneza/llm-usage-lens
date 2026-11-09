import { z } from "zod";

import { COLLECTOR_REGION } from "../region";
import { AccountIdSchema, Iso8601Schema } from "./primitives";

// Source: docs/specs/2026-05-15-data-model.md — "Entity: AccountMeta".
export const AccountMetaSchema = z.object({
  accountId: AccountIdSchema,
  accountName: z.string().min(1),
  departmentId: z.string().min(1),
  departmentName: z.string().min(1),
  teamId: z.string().min(1),
  teamName: z.string().min(1),
  region: z.literal(COLLECTOR_REGION),
  active: z.boolean(),
  createdAt: Iso8601Schema,
  updatedAt: Iso8601Schema,
});

export type AccountMeta = z.infer<typeof AccountMetaSchema>;

// Settings CRUD bodies — docs/specs/2026-05-15-data-model.md "API Routes".
export const CreateAccountInputSchema = AccountMetaSchema.omit({
  active: true,
  createdAt: true,
  updatedAt: true,
});

export type CreateAccountInput = z.infer<typeof CreateAccountInputSchema>;

export const UpdateAccountPatchSchema = AccountMetaSchema.omit({
  accountId: true,
  active: true,
  createdAt: true,
  updatedAt: true,
}).partial();

export type UpdateAccountPatch = z.infer<typeof UpdateAccountPatchSchema>;
