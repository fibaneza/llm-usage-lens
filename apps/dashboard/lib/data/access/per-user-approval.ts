import "server-only";

import { PerUserApprovalSchema } from "@llm-usage-lens/shared";
import type { PerUserApproval } from "@llm-usage-lens/shared";

import { GOVERNANCE_PK } from "./keys";
import { getItem } from "./store";

// Source: docs/specs/2026-11-10-access-control.md - "Visibility and
// inheritance" (organisation cap) and "Data model additions" (PerUserApproval,
// GOVERNANCE/PER_USER). A missing item means "not approved", not an error.
export const PER_USER_SK = "PER_USER";

export async function getPerUserApproval(): Promise<PerUserApproval | null> {
  const item = await getItem(GOVERNANCE_PK, PER_USER_SK);
  return item ? PerUserApprovalSchema.parse(item) : null;
}
