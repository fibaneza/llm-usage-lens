// Test-only helpers for the INV1 suites (data layer and the accept and
// candidates routes). Not imported by production code. Placeholder ids only
// (Rule 50.9). Source: docs/specs/2026-11-10-access-control.md - "Accept a
// pending invite (unit INV1)".
// access-test-support first: it must finish loading before the (mocked)
// DynamoDB module is pulled in through the data layer.
import { ctxAt, ok } from "./access-test-support";

import { createPendingItem } from "@/lib/data/access/pending";
import { putRaw } from "@/test/support/test-support";

export { ENTRA_ISSUER, FOREIGN_TENANT, TENANT } from "./password-test-support";
import { TENANT } from "./password-test-support";

export const KEY = "jane@example.com";
// A guest UPN encodes the address with "_" for "@" (spec: jane_example.com#EXT#@...).
export const GUEST_UPN = "jane_example.com#EXT#@contoso.onmicrosoft.com";
export const JANE_OID = "00000000-0000-4000-8000-0000000003a1";
export const OTHER_OID = "00000000-0000-4000-8000-0000000003a2";

export type SeedIdentity = {
  upn?: string;
  email?: string;
  displayName?: string;
  tid?: string;
  roles?: string[];
};

// A person who has signed in at least once (an IDENT# META item).
export async function seedSignedIn(
  oid: string,
  over: SeedIdentity = {},
): Promise<void> {
  await putRaw({
    PK: `IDENT#${oid}`,
    SK: "META",
    gsi1pk: "IDENTS",
    gsi1sk: `IDENT#${oid}`,
    oid,
    tid: over.tid ?? TENANT,
    ...(over.upn !== undefined ? { upn: over.upn } : {}),
    ...(over.email !== undefined ? { email: over.email } : {}),
    displayName: over.displayName ?? `Person ${oid.slice(-3)}`,
    lastSignInAt: "2026-01-01T00:00:00.000Z",
    lastSeenRoles: over.roles ?? ["internal-viewer"],
    authMethod: "entra",
    version: 1,
    failedAttempts: 2,
    lockedUntil: "2026-01-01T01:00:00.000Z",
  });
}

// Seeds are stamped on a day that is never "today" (matrix-route-support precedent).
const SEED_NOW = new Date("2026-01-02T03:04:05.000Z");
let seedCount = 0;
const seedCtx = () => ctxAt(SEED_NOW, `req-inv-seed-${++seedCount}`);

// `sentBy` is the oid that sent the invite (the sender of the spec).
export async function seedInvite(key: string, teamId: string, sentBy?: string) {
  return ok(
    await createPendingItem(
      { kind: "affiliation", emailOrUpn: key, teamId },
      sentBy ? { ...seedCtx(), actor: sentBy } : seedCtx(),
    ),
  );
}

export async function seedAdminScopeInvite(
  key: string,
  scopeType: "team" | "department",
  scopeId: string,
) {
  return ok(
    await createPendingItem(
      { kind: "adminScope", emailOrUpn: key, scopeType, scopeId },
      seedCtx(),
    ),
  );
}

export const acceptPath = (team: string, key: string) =>
  `/api/teams/${team}/members/pending/${encodeURIComponent(key)}/accept`;
export const candidatesPath = (team: string, key: string) =>
  `/api/teams/${team}/members/pending/${encodeURIComponent(key)}/candidates`;
