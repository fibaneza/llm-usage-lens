// Test-only helpers shared by the 4R.4 slice 4 route suites (team members,
// admin scopes, visibility writes, affiliation move, identities and links).
// Not imported by production code. Rule 60.22: the routes run against
// DynamoDB Local with the real data layer and policy module; only `@/auth` is
// mocked by the suites.
import { expect } from "vitest";

import { deniedToday } from "./governance-route-support";

import {
  CURSOR_SECRET,
  ctxAt,
  ok,
} from "@/lib/data/access/access-test-support";
import {
  grantAdminScope,
  listAdminScopes,
} from "@/lib/data/access/admin-scopes";
import { addMember, getAffiliation } from "@/lib/data/access/affiliations";
import { loadFixtures, putRaw } from "@/test/test-support";

import { CALLERS, accounts } from "./scope-fixtures";

export {
  deniedToday,
  auditToday,
  expectData,
  expectError,
  expectNoStore,
  invoke,
  nonAuditItems,
} from "./governance-route-support";
export { CALLERS, signInAs, accounts } from "./scope-fixtures";
export type { CallerName } from "./scope-fixtures";

// Seeds are stamped on a day that is never "today", so a test counting the
// audit records of its own request (`auditToday()`) never sees them.
const SEED_NOW = new Date("2026-01-02T03:04:05.000Z");
let seedCount = 0;
export const seedCtx = () => ctxAt(SEED_NOW, `req-seed-${++seedCount}`);

const oid = (n: number) => `00000000-0000-4000-8000-0000000002${n}0`;
// People who are not callers: the targets of member and admin writes.
export const PEOPLE = {
  alice: { oid: oid(1), email: "alice@company.com", name: "Alice" },
  bob: { oid: oid(2), email: "bob@company.com", name: "Bob" },
  carol: { oid: oid(3), email: "carol@company.com", name: "Carol" },
  dave: { oid: oid(4), email: "dave@company.com", name: "Dave" },
} as const;
export type PersonName = keyof typeof PEOPLE;

// A well-formed id that names no team, department or identity.
export const MISSING = "no-such-thing";

export async function seedIdentity(
  id: string,
  over: { email?: string; name?: string } = {},
): Promise<void> {
  await putRaw({
    PK: `IDENT#${id}`,
    SK: "META",
    gsi1pk: "IDENTS",
    gsi1sk: `IDENT#${id}`,
    oid: id,
    tid: "00000000-0000-4000-8000-0000000000ff",
    email: over.email ?? `${id}@company.com`,
    displayName: over.name ?? id,
    lastSignInAt: "2026-01-01T00:00:00.000Z",
    lastSeenRoles: ["internal-viewer"],
    authMethod: "entra",
    version: 1,
    // Lockout state must never reach a response.
    failedAttempts: 2,
    lockedUntil: "2026-01-01T01:00:00.000Z",
  });
}

// Accounts (team-a, team-b in dept-eng; team-c, team-m in dept-ops), an
// identity for every person, and the callers' own items: memberA in team-a,
// memberB in team-b, teamAdminA with a team scope on team-a and deptAdminEng
// with a department scope on dept-eng. team-c and team-m hold nothing else, so
// list and pagination tests use them for exact counts.
export async function seedWorld(): Promise<void> {
  await loadFixtures({ accounts });
  for (const p of Object.values(PEOPLE)) {
    await seedIdentity(p.oid, { email: p.email, name: p.name });
  }
  await seedMember(CALLERS.memberA.oid, "team-a");
  await seedMember(CALLERS.memberB.oid, "team-b");
  await seedAdminScope(CALLERS.teamAdminA.oid, "team", "team-a");
  await seedAdminScope(CALLERS.deptAdminEng.oid, "department", "dept-eng");
}

export async function seedMember(id: string, teamId: string) {
  return ok(await addMember({ oid: id, teamId }, seedCtx()));
}

export async function seedAdminScope(
  id: string,
  scopeType: "team" | "department",
  scopeId: string,
) {
  return ok(await grantAdminScope({ oid: id, scopeType, scopeId }, seedCtx()));
}

export const affiliationOf = (id: string) => getAffiliation(id);

export async function scopesOf(id: string) {
  return ok(await listAdminScopes(id, { cursorSecret: CURSOR_SECRET })).items;
}

// Identical bodies for a missing and an out-of-scope target, with no id echoed
// (Access Control spec - Enforcement item 2, T15).
export function expectSameBody(a: unknown, b: unknown, ...leaks: string[]) {
  expect(a).toEqual(b);
  for (const leak of leaks) expect(JSON.stringify(a)).not.toContain(leak);
}

// Exactly one `denied` security record for this request (D17, T22): the actor,
// the operation and the refusal code. `route` (the fixed pattern, never the raw
// path) is asserted for refusals that happen before parsing. The raw values in
// `forbiddenRaw` must appear nowhere in the record.
export async function expectOneDenied(args: {
  actor: string;
  action: string;
  code: "FORBIDDEN" | "NOT_FOUND";
  route?: { method: string; pattern: string };
  forbiddenRaw?: string[];
}): Promise<void> {
  const denied = await deniedToday();
  expect(denied).toHaveLength(1);
  expect(denied[0]).toMatchObject({
    action: args.action,
    result: "denied",
    category: "security",
    code: args.code,
    actor: args.actor,
    ...(args.route ? { route: args.route } : {}),
  });
  for (const raw of args.forbiddenRaw ?? []) {
    expect(JSON.stringify(denied[0])).not.toContain(raw);
  }
}
