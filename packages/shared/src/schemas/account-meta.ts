import { z } from "zod";

import { AccountIdSchema, Iso8601Schema } from "./primitives";

// Source: docs/specs/2026-05-15-data-model.md — "Entity: AccountMeta".
export const AccountMetaSchema = z.object({
  accountId: AccountIdSchema,
  accountName: z.string().min(1),
  departmentId: z.string().min(1),
  departmentName: z.string().min(1),
  teamId: z.string().min(1),
  teamName: z.string().min(1),
  region: z.string().min(1),
  active: z.boolean(),
  createdAt: Iso8601Schema,
  updatedAt: Iso8601Schema,
});

export type AccountMeta = z.infer<typeof AccountMetaSchema>;
