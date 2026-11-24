import "server-only";

import type { PersonInvite } from "@llm-usage-lens/shared";

import { listPendingFor } from "@/lib/data/access/pending";

// Source: docs/specs/2026-11-10-access-control.md - "Placing a person by hand"
// (a person is `invited` when a pending member invite exists for their email
// or UPN, and then carries `invites: [{ teamId, key }, ...]`, every such
// invite, one Approve and add per team; review W4 of INV2). Read per request,
// never cached (Rule 60.10). The caller decides who may see the result:
// readers get none of it (T-IV5).
export async function findPersonInvites(
  emailsOrUpns: ReadonlyArray<string | null | undefined>,
): Promise<PersonInvite[]> {
  const keys = new Set(
    emailsOrUpns.flatMap((k) => {
      const key = k?.trim().toLowerCase();
      return key ? [key] : [];
    }),
  );
  const invites: PersonInvite[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    for (const item of await listPendingFor([key])) {
      if (item.kind !== "affiliation") continue;
      const id = `${item.teamId}\u0000${key}`;
      if (seen.has(id)) continue;
      seen.add(id);
      invites.push({ teamId: item.teamId, key });
    }
  }
  return invites;
}
