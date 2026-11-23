import {
  DeleteCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { ctxAt, ok } from "@/test/support/access-test-support";
import { createPendingItem } from "@/lib/data/access/pending";
import { grantRole } from "@/lib/data/access/role-grants";
import {
  CALLERS,
  PEOPLE,
  auditToday,
  deniedToday,
  expectData,
  expectError,
  invoke,
  seedAdminScope,
  seedCtx,
  seedIdentity,
  seedMember,
  seedWorld,
  signInAs,
  type CallerName,
} from "@/test/support/matrix-route-support";
import {
  TEST_TABLE_NAME,
  clearTable,
  ensureTestTable,
  testDoc,
} from "@/test/support/test-support";

import { GET as GET_PENDING } from "../access/pending/route";
import { GET as GET_STALE } from "../access/stale/route";

// Source: docs/specs/2026-11-10-access-control.md - "Membership, admin scopes
// and lifecycle" (Joiner: pending items by email/UPN grant nothing until bound;
// Leaver: stale = pending items not bound after 30 days, and affiliations,
// admin scopes and in-app grants whose user has not signed in for 90 days,
// decision D2; "Settings list ... filtered by the management-read rule and
// paginated with the opaque cursor"), D34 reversed by the user on 2026-11-15
// (the lists are built in 4R.4), "Permission matrix" (a team-scope admin
// manages its team, a department-scope admin its department's teams; role
// grants are configuration: internal-admin, internal-auditor), D37 (names for
// in-scope rows only), "Enforcement" items 2, 4 (read per request) and 7
// (reads set no-store and write no audit record). 401 for every GET route is
// also covered by unauthenticated-routes.integration.test.ts.
//
// Routes to build (assumed API, see the tdd report):
//   GET /api/access/pending -> { data: { items: PendingItem[], cursor? } }
//     every pending item in the caller's management scope.
//   GET /api/access/stale   -> { data: { items: StaleRow[], cursor? } }
//     StaleRow = { reason: "pending" | "inactive",
//                  kind: "affiliation" | "adminScope" | "roleGrant",
//                  subject: emailOrUpn (pending) | oid (inactive),
//                  displayName?, email? (inactive, from the identity),
//                  teamId? | scopeType? + scopeId? | role?, since: ISO }
//     reason "pending": pending item created more than 30 days ago;
//     reason "inactive": the bound person's lastSignInAt is more than 90 days
//     ago (an identity record is required: none means never seen, not stale).
//   Both: ?limit and an opaque ?cursor (Rule 20.6, loop on LastEvaluatedKey).
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});

const NOW = new Date("2026-11-15T12:00:00.000Z");
const DAY = 86_400_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

type Pending = {
  kind: string;
  emailOrUpn: string;
  teamId?: string;
  scopeType?: string;
  scopeId?: string;
  createdAt: string;
};
type Stale = {
  reason: string;
  kind: string;
  subject: string;
  displayName?: string | null;
  email?: string | null;
  teamId?: string;
  scopeType?: string;
  scopeId?: string;
  role?: string;
  since: string;
};
type Page<T> = { items: T[]; cursor?: string };

const pending = (query = "") =>
  invoke(GET_PENDING, { method: "GET", path: `/api/access/pending${query}` });
const stale = (query = "") =>
  invoke(GET_STALE, { method: "GET", path: `/api/access/stale${query}` });

let seq = 0;
async function seedPending(
  input: Parameters<typeof createPendingItem>[0],
  createdAt: Date,
) {
  ok(await createPendingItem(input, ctxAt(createdAt, `req-pending-${++seq}`)));
}

async function setLastSignIn(oid: string, at: Date) {
  await testDoc().send(
    new UpdateCommand({
      TableName: TEST_TABLE_NAME,
      Key: { PK: `IDENT#${oid}`, SK: "META" },
      UpdateExpression: "SET lastSignInAt = :t",
      ExpressionAttributeValues: { ":t": at.toISOString() },
    }),
  );
}

const FRANK = "00000000-0000-4000-8000-000000000f01";

// The seed writer adds the dev team-lead identity with a team scope to every
// fixture load that has accounts (Access Control spec - "Dev sign-in as a
// lead", D14). Its lastSignInAt is the account's createdAt, so it would be a
// stale row. These tests count stale rows exactly, over the rows seedAccess
// writes, so the dev-only identity is removed.
const DEV_LEAD_PK = "IDENT#local:team-lead@localhost";
async function removeDevSeedLead() {
  const rows = await testDoc().send(
    new QueryCommand({
      TableName: TEST_TABLE_NAME,
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: { ":pk": DEV_LEAD_PK },
    }),
  );
  for (const row of rows.Items ?? []) {
    await testDoc().send(
      new DeleteCommand({
        TableName: TEST_TABLE_NAME,
        Key: { PK: row.PK, SK: row.SK },
      }),
    );
  }
}

async function seedAccess() {
  // Pending: 5 d (fresh), 75 d (stale), 26 d, 61 d (stale), exactly 30 d (not
  // stale: the limit is "more than 30 days"), 30 d + 1 ms (stale).
  await seedPending(
    {
      kind: "affiliation",
      emailOrUpn: "new.hire@example.com",
      teamId: "team-a",
    },
    ago(5 * DAY),
  );
  await seedPending(
    {
      kind: "affiliation",
      emailOrUpn: "old.hire@example.com",
      teamId: "team-c",
    },
    ago(75 * DAY),
  );
  await seedPending(
    {
      kind: "adminScope",
      emailOrUpn: "team.lead@example.com",
      scopeType: "team",
      scopeId: "team-b",
    },
    ago(26 * DAY),
  );
  await seedPending(
    {
      kind: "adminScope",
      emailOrUpn: "dept.lead@example.com",
      scopeType: "department",
      scopeId: "dept-ops",
    },
    ago(61 * DAY),
  );
  await seedPending(
    {
      kind: "affiliation",
      emailOrUpn: "exactly.30@example.com",
      teamId: "team-b",
    },
    ago(30 * DAY),
  );
  await seedPending(
    {
      kind: "affiliation",
      emailOrUpn: "just.over@example.com",
      teamId: "team-b",
    },
    ago(30 * DAY + 1),
  );

  // Bound access. alice: 90 d + 1 ms (stale); bob: exactly 90 d (not stale);
  // carol: admin scope, 120 d; dave: in-app grant, 120 d; frank: team-a, 100 d.
  await seedIdentity(FRANK, { email: "frank@company.com", name: "Frank" });
  await seedMember(PEOPLE.alice.oid, "team-c");
  await seedMember(PEOPLE.bob.oid, "team-c");
  await seedAdminScope(PEOPLE.carol.oid, "team", "team-c");
  ok(
    await grantRole(
      { oid: PEOPLE.dave.oid, role: "internal-org-admin", reason: "cover" },
      seedCtx(),
    ),
  );
  await seedMember(FRANK, "team-a");
  await setLastSignIn(PEOPLE.alice.oid, ago(90 * DAY + 1));
  await setLastSignIn(PEOPLE.bob.oid, ago(90 * DAY));
  await setLastSignIn(PEOPLE.carol.oid, ago(120 * DAY));
  await setLastSignIn(PEOPLE.dave.oid, ago(120 * DAY));
  await setLastSignIn(FRANK, ago(100 * DAY));
}

const pendingKeys = (items: Pending[]) => items.map((i) => i.emailOrUpn).sort();
const staleKeys = (items: Stale[]) =>
  items.map((i) => `${i.reason}:${i.subject}`).sort();

const ALL_PENDING = [
  "dept.lead@example.com",
  "exactly.30@example.com",
  "just.over@example.com",
  "new.hire@example.com",
  "old.hire@example.com",
  "team.lead@example.com",
];
const STALE_NO_GRANT = [
  `inactive:${PEOPLE.alice.oid}`,
  `inactive:${PEOPLE.carol.oid}`,
  `inactive:${FRANK}`,
  "pending:dept.lead@example.com",
  "pending:just.over@example.com",
  "pending:old.hire@example.com",
].sort();
const STALE_ALL = [...STALE_NO_GRANT, `inactive:${PEOPLE.dave.oid}`].sort();

beforeAll(ensureTestTable);
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  await clearTable();
  await seedWorld();
  await removeDevSeedLead();
  await seedAccess();
  signInAs("admin");
});
afterEach(() => vi.useRealTimers());

describe("GET /api/access/pending", () => {
  it.each(["memberA", "viewerNone"] as CallerName[])(
    "%s: 403 FORBIDDEN with no item in the body, and no denied record (reads are metric-only)",
    async (caller) => {
      signInAs(caller);
      const body = await expectError(await pending(), 403, "FORBIDDEN");
      expect(JSON.stringify(body)).not.toContain("example.com");
      expect(await deniedToday()).toEqual([]);
    },
  );

  it.each(["admin", "orgAdmin", "auditor"] as CallerName[])(
    "%s lists every pending item as { data: { items } } with no-store",
    async (caller) => {
      signInAs(caller);
      const data = await expectData<Page<Pending>>(await pending());
      expect(pendingKeys(data.items)).toEqual(ALL_PENDING);
      expect(
        data.items.find((i) => i.emailOrUpn === "new.hire@example.com"),
      ).toMatchObject({
        kind: "affiliation",
        teamId: "team-a",
        createdAt: ago(5 * DAY).toISOString(),
      });
      expect(
        data.items.find((i) => i.emailOrUpn === "dept.lead@example.com"),
      ).toMatchObject({
        kind: "adminScope",
        scopeType: "department",
        scopeId: "dept-ops",
      });
    },
  );

  it("a team-scope admin sees the pending items of its team only", async () => {
    signInAs("teamAdminA");
    const data = await expectData<Page<Pending>>(await pending());
    expect(pendingKeys(data.items)).toEqual(["new.hire@example.com"]);
  });

  it("a department-scope admin sees its department's teams only: team items, team-scope admin invites, nothing of dept-ops", async () => {
    signInAs("deptAdminEng");
    const data = await expectData<Page<Pending>>(await pending());
    expect(pendingKeys(data.items)).toEqual([
      "exactly.30@example.com",
      "just.over@example.com",
      "new.hire@example.com",
      "team.lead@example.com",
    ]);
  });

  it("paginates with ?limit and an opaque cursor; the pages hold every item once", async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const query = `?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const data = await expectData<Page<Pending>>(await pending(query));
      expect(data.items.length).toBeLessThanOrEqual(2);
      seen.push(...data.items.map((i) => i.emailOrUpn));
      cursor = data.cursor;
      if (cursor) expect(cursor).not.toContain("PENDING");
      pages += 1;
    } while (cursor && pages < 20);
    expect(pages).toBeGreaterThan(1);
    expect(seen.sort()).toEqual(ALL_PENDING);
  });

  it("400 BAD_REQUEST for a tampered cursor and for a zero limit", async () => {
    await expectError(await pending("?cursor=garbage"), 400, "BAD_REQUEST");
    await expectError(await pending("?limit=0"), 400, "BAD_REQUEST");
  });

  it("is a read: nothing is written and nothing is audited", async () => {
    const audited = (await auditToday()).length;
    await expectData(await pending());
    expect(await auditToday()).toHaveLength(audited);
  });

  it("authorization is read per request: a scope granted after the first read shows on the next", async () => {
    signInAs("viewerNone");
    await expectError(await pending(), 403, "FORBIDDEN");
    await seedAdminScope(CALLERS.viewerNone.oid, "team", "team-c");
    const data = await expectData<Page<Pending>>(await pending());
    expect(pendingKeys(data.items)).toEqual(["old.hire@example.com"]);
  });
});

describe("GET /api/access/stale", () => {
  it.each(["memberA", "viewerNone"] as CallerName[])(
    "%s: 403 FORBIDDEN with no row in the body",
    async (caller) => {
      signInAs(caller);
      const body = await expectError(await stale(), 403, "FORBIDDEN");
      expect(JSON.stringify(body)).not.toContain("company.com");
    },
  );

  it.each(["admin", "auditor"] as CallerName[])(
    "%s sees pending items unbound for more than 30 days and bound access idle for more than 90 days, in-app grants included",
    async (caller) => {
      signInAs(caller);
      const data = await expectData<Page<Stale>>(await stale());
      // The 30 d and 90 d boundaries are exclusive: exactly.30 and bob are out.
      expect(staleKeys(data.items)).toEqual(STALE_ALL);
    },
  );

  it("an org-admin sees the same rows except in-app role grants (configuration is admin and auditor only)", async () => {
    signInAs("orgAdmin");
    const data = await expectData<Page<Stale>>(await stale());
    expect(staleKeys(data.items)).toEqual(STALE_NO_GRANT);
  });

  it("describes each row: reason, kind, where it applies and the date it is stale since", async () => {
    const data = await expectData<Page<Stale>>(await stale());
    const row = (key: string) =>
      data.items.find((i) => `${i.reason}:${i.subject}` === key);
    expect(row("pending:old.hire@example.com")).toMatchObject({
      kind: "affiliation",
      teamId: "team-c",
      since: ago(75 * DAY).toISOString(),
    });
    expect(row("pending:dept.lead@example.com")).toMatchObject({
      kind: "adminScope",
      scopeType: "department",
      scopeId: "dept-ops",
    });
    expect(row(`inactive:${PEOPLE.alice.oid}`)).toMatchObject({
      kind: "affiliation",
      teamId: "team-c",
      displayName: PEOPLE.alice.name,
      email: PEOPLE.alice.email,
      since: ago(90 * DAY + 1).toISOString(),
    });
    expect(row(`inactive:${PEOPLE.carol.oid}`)).toMatchObject({
      kind: "adminScope",
      scopeType: "team",
      scopeId: "team-c",
    });
    expect(row(`inactive:${PEOPLE.dave.oid}`)).toMatchObject({
      kind: "roleGrant",
      role: "internal-org-admin",
    });
  });

  it("an affiliation whose person has no identity record (never signed in) is not stale", async () => {
    const data = await expectData<Page<Stale>>(await stale());
    expect(data.items.some((i) => i.subject === CALLERS.memberA.oid)).toBe(
      false,
    );
  });

  it("a team-scope admin sees the stale rows of its team only, with names for those rows", async () => {
    signInAs("teamAdminA");
    const data = await expectData<Page<Stale>>(await stale());
    expect(staleKeys(data.items)).toEqual([`inactive:${FRANK}`]);
    expect(data.items[0]).toMatchObject({
      displayName: "Frank",
      email: "frank@company.com",
    });
  });

  it("a department-scope admin sees its department's teams only, never role grants or dept-ops rows", async () => {
    signInAs("deptAdminEng");
    const data = await expectData<Page<Stale>>(await stale());
    expect(staleKeys(data.items)).toEqual([
      `inactive:${FRANK}`,
      "pending:just.over@example.com",
    ]);
  });

  it("paginates with ?limit and an opaque cursor; the pages hold every row once", async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const query = `?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const data = await expectData<Page<Stale>>(await stale(query));
      expect(data.items.length).toBeLessThanOrEqual(2);
      seen.push(...staleKeys(data.items));
      cursor = data.cursor;
      pages += 1;
    } while (cursor && pages < 20);
    expect(pages).toBeGreaterThan(1);
    expect(seen.sort()).toEqual(STALE_ALL);
  });

  it("400 BAD_REQUEST for a tampered cursor", async () => {
    await expectError(await stale("?cursor=garbage"), 400, "BAD_REQUEST");
  });

  it("is a read: nothing is audited", async () => {
    const audited = (await auditToday()).length;
    await expectData(await stale());
    expect(await auditToday()).toHaveLength(audited);
  });
});

// Q-B3 (review r1; Design System - Management pages, "List, then the team",
// Pending and stale access (D-TM3): the filter runs on the server; both routes
// take an optional `teamId` query (Zod), scoped as before, and answer as before
// without it). The rows of a team are its member invitations and member
// affiliations only: pending admin scopes and role grants stay in Settings.
// The shared route-contract suite owns 401/403/no-store, so only the filter is
// asserted here.
describe("?teamId= filter on /api/access/pending and /api/access/stale (Q-B3)", () => {
  it.each([
    ["team-a", ["new.hire@example.com"]],
    ["team-b", ["exactly.30@example.com", "just.over@example.com"]],
    ["team-c", ["old.hire@example.com"]],
    ["team-none", []],
  ])(
    "pending ?teamId=%s returns that team's member invitations only",
    async (teamId, emails) => {
      const data = await expectData<Page<Pending>>(
        await pending(`?teamId=${teamId}`),
      );
      expect(pendingKeys(data.items)).toEqual(emails);
    },
  );

  it.each([
    ["team-a", [`inactive:${FRANK}`]],
    ["team-b", ["pending:just.over@example.com"]],
    [
      "team-c",
      [`inactive:${PEOPLE.alice.oid}`, "pending:old.hire@example.com"].sort(),
    ],
  ])(
    "stale ?teamId=%s returns that team's member rows only (no admin scope, no role grant)",
    async (teamId, keys) => {
      const data = await expectData<Page<Stale>>(
        await stale(`?teamId=${teamId}`),
      );
      expect(staleKeys(data.items)).toEqual(keys);
    },
  );

  it("is still scoped as before: a team-scope admin asking for another team gets no rows, and none of its own beyond its team", async () => {
    signInAs("teamAdminA");
    const other = await expectData<Page<Pending>>(
      await pending("?teamId=team-c"),
    );
    expect(other.items).toEqual([]);
    const own = await expectData<Page<Pending>>(
      await pending("?teamId=team-a"),
    );
    expect(pendingKeys(own.items)).toEqual(["new.hire@example.com"]);
    const otherStale = await expectData<Page<Stale>>(
      await stale("?teamId=team-c"),
    );
    expect(otherStale.items).toEqual([]);
  });

  // No oracle (coordinator ruling 2026-11-23; Design System - "List, then the
  // team", Pending and stale access): a scoped lead cannot tell an
  // out-of-scope team that exists from an id that exists nowhere.
  it("a team-scope admin gets identical responses for an out-of-scope existing team and an unknown team, on both routes", async () => {
    signInAs("teamAdminA");
    for (const route of [pending, stale]) {
      const outOfScope = await route("?teamId=team-c");
      const unknown = await route("?teamId=team-does-not-exist");
      expect(outOfScope.status).toBe(200);
      expect(unknown.status).toBe(200);
      const a = await outOfScope.json();
      const b = await unknown.json();
      expect(a).toEqual(b);
      expect(a.data.items).toEqual([]);
    }
  });

  it("a department-scope admin gets a team of its department and nothing for another department's team", async () => {
    signInAs("deptAdminEng");
    const inside = await expectData<Page<Pending>>(
      await pending("?teamId=team-b"),
    );
    expect(pendingKeys(inside.items)).toEqual([
      "exactly.30@example.com",
      "just.over@example.com",
    ]);
    const outside = await expectData<Page<Pending>>(
      await pending("?teamId=team-c"),
    );
    expect(outside.items).toEqual([]);
    const outsideStale = await expectData<Page<Stale>>(
      await stale("?teamId=team-c"),
    );
    expect(outsideStale.items).toEqual([]);
  });

  it("the team's invitation that is on page 2 of the unfiltered list is returned on the first filtered page", async () => {
    const first = await expectData<Page<Pending>>(await pending("?limit=2"));
    const onFirst = new Set(first.items.map((i) => i.emailOrUpn));
    const target = (
      await expectData<Page<Pending>>(await pending("?limit=100"))
    ).items.find((i) => i.kind === "affiliation" && !onFirst.has(i.emailOrUpn));
    expect(target?.teamId).toBeDefined();
    const filtered = await expectData<Page<Pending>>(
      await pending(`?teamId=${target?.teamId}&limit=2`),
    );
    expect(filtered.items.map((i) => i.emailOrUpn)).toContain(
      target?.emailOrUpn,
    );
  });

  it("the team's stale row that is on page 2 of the unfiltered list is returned on the first filtered page", async () => {
    const first = await expectData<Page<Stale>>(await stale("?limit=2"));
    const onFirst = new Set(staleKeys(first.items));
    const target = (
      await expectData<Page<Stale>>(await stale("?limit=100"))
    ).items.find(
      (i) =>
        i.kind === "affiliation" && !onFirst.has(`${i.reason}:${i.subject}`),
    );
    expect(target?.teamId).toBeDefined();
    const filtered = await expectData<Page<Stale>>(
      await stale(`?teamId=${target?.teamId}&limit=2`),
    );
    expect(staleKeys(filtered.items)).toContain(
      `${target?.reason}:${target?.subject}`,
    );
  });

  it("filtered pages paginate: ?limit=1 walks both of team-b's invitations once", async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const query = `?teamId=team-b&limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const data = await expectData<Page<Pending>>(await pending(query));
      seen.push(...data.items.map((i) => i.emailOrUpn));
      cursor = data.cursor;
      pages += 1;
    } while (cursor && pages < 10);
    expect(seen.sort()).toEqual([
      "exactly.30@example.com",
      "just.over@example.com",
    ]);
  });

  it("400 BAD_REQUEST for an empty teamId, on both routes", async () => {
    await expectError(await pending("?teamId="), 400, "BAD_REQUEST");
    await expectError(await stale("?teamId="), 400, "BAD_REQUEST");
  });

  it("without teamId both routes answer as before", async () => {
    const p = await expectData<Page<Pending>>(await pending());
    expect(pendingKeys(p.items)).toEqual(ALL_PENDING);
    const s = await expectData<Page<Stale>>(await stale());
    expect(staleKeys(s.items)).toEqual(STALE_ALL);
  });
});
