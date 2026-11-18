import "server-only";

import type { PendingItem } from "@llm-usage-lens/shared";

import { listPendingFor } from "@/lib/data/access/pending";

// Source: docs/specs/2026-11-10-access-control.md - "Accept a pending invite
// (unit INV1)": only a pending *member* invitation for this team can be
// accepted; an admin-scope item or another team's invite is the missing-key 404.
export type MemberInvite = Extract<PendingItem, { kind: "affiliation" }>;

export async function findMemberInvite(
  teamId: string,
  key: string,
): Promise<MemberInvite | null> {
  const found = (await listPendingFor([key])).find(
    (item): item is MemberInvite =>
      item.kind === "affiliation" && item.teamId === teamId,
  );
  return found ?? null;
}
