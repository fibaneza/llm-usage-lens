import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { createHash } from "node:crypto";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { installFakeOtel, recordedSpans } from "@/test/fakes/otel-fake";
import {
  CURSOR_SECRET,
  ctxAt,
  ok,
  seedSsoAffiliation,
} from "@/test/support/access-test-support";
import { ENTRA_ISSUER } from "@/test/support/password-test-support";
import { seedSignedIn } from "@/test/support/invite-accept-support";
import {
  TEST_TABLE_NAME,
  clearTable,
  ensureTestTable,
  loadFixtures,
  makeAccount,
  testDoc,
} from "@/test/support/test-support";
import {
  allItems,
  installSyncFake,
  keyOf,
  newSyncState,
  nonReadCalls,
  pagesRead,
  stubSyncEnv,
} from "@/test/support/user-sync-support";
import type {
  RunView,
  SyncFakeState,
  SyncFakeUser,
} from "@/test/support/user-sync-support";

// DynamoDB seam: every command passes through `hook`, so a test can observe the
// lease writes, fail the n-th change, or take the lease away mid-run.
const hook = vi.hoisted(() => ({
  before: null as null | ((name: string, input: unknown) => Promise<void>),
  after: null as null | ((name: string, input: unknown) => Promise<void>),
  sent: [] as { name: string; input: unknown }[],
}));
vi.mock("@/lib/dynamodb", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/dynamodb")>("@/lib/dynamodb");
  return {
    ...actual,
    getDocumentClient: () => {
      const real = actual.getDocumentClient();
      return new Proxy(real, {
        get(target, prop) {
          if (prop === "send") {
            return async (command: {
              constructor: { name: string };
              input: unknown;
            }) => {
              const name = command.constructor.name;
              hook.sent.push({ name, input: command.input });
              await hook.before?.(name, command.input);
              const out = await target.send(command as never);
              await hook.after?.(name, command.input);
              return out;
            };
          }
          const value = Reflect.get(target, prop, target) as unknown;
          return typeof value === "function"
            ? (value as (...a: unknown[]) => unknown).bind(target)
            : value;
        },
      });
    },
  };
});

import { listAdminScopes } from "@/lib/data/access/admin-scopes";
import { addMember, getAffiliation } from "@/lib/data/access/affiliations";
import { listAuditRecords } from "@/lib/data/access/audit";
import {
  getIdentityLink,
  getLiteLLMUserOwner,
  writeLiteLLMUserLink,
} from "@/lib/data/access/identity-links";
import { createPasswordUser } from "@/lib/data/access/password-users";
import { listPendingFor } from "@/lib/data/access/pending";
import { putTeamLink } from "@/lib/data/litellm/team-links";

// Source: docs/specs/2026-11-10-access-control.md - "LiteLLM user sync" (the
// user's rules; *Same person*; *Users* table; *Pending LiteLLM links*;
// *Clean-up of dashboard placeholders*; *Teams*; *Scheduled run*; *Preview and
// apply*; *Records*), "Match keys per sign-in mode"; tests T-SY1, T-SY2, T-SY3,
// T-SY4, T-SY5 (lease), T-SY7, T-SY10, T-SY11, T-SY12, T-SM1, T-SM2. LiteLLM is
// the in-process fake (Rule 60.24); the sync must only ever read it (T-SY11:
// the afterEach below fails any test whose run made another call).
//
// Contract for the developer (assumed names; the spec fixes the behaviour):
//   lib/litellm-user-sync/run.ts exports
//     runLiteLLMUserSync({ actor, trigger, mode, planHash? })
//       actor: string - the caller's oid, or "system" for the scheduled run
//       trigger: "manual" | "schedule";  mode: "preview" | "apply"
//     -> { ok: true, value } | { ok: false, code }
//     code: PLAN_CHANGED | PLAN_TRUNCATED | SYNC_RUNNING (expected outcomes are
//     returned); a LiteLLM or DynamoDB failure rejects and writes no summary.
//     value (both modes): plan { planHash, truncated, users[], drift[], notes[] }
//       users[]: { litellmUserId, outcome, reason?, oid?, key?, matchedKey? }
//       drift[]: { oid, teamId }
//     value (apply): { runId, applied, remaining, unplaced[], notes[], skipped? }
//       unplaced[]: { litellmUserId, reason: multiple-teams|other-team|
//       no-linked-team }; notes holds "removal-guard"; skipped is "disabled" or
//       "locked" (the run did nothing; the summary carries it).
//     A scheduled apply takes no planHash. A manual apply recomputes the plan
//     and applies it only when the hash is equal.
//   Audit: every change and the summary carry the run's id, as `requestId` or
//     `after.runId`; the link record carries `after.mode: "sync"` and
//     `after.matchedKey: "oid" | "email"`; the summary is
//     `litellm.user.sync` with `after.trigger`, `after.truncated`,
//     `after.planHash` and, when the run did nothing, `after.skipped`.
//   Storage: the lease is `LITELLM#USERSYNC` / `LOCK` { owner, leaseUntil };
//     a PendingLiteLLMLink is `PENDING#{key}` / `LITELLMLINK`.
const NOW = new Date("2026-11-24T10:00:00.000Z");
const DAY = "2026-11-24";
const ADMIN = "00000000-0000-4000-8000-0000000000ad";
const ALICE = "00000000-0000-4000-8000-0000000000a1";
const BOB = "00000000-0000-4000-8000-0000000000b2";
const CAROL = "00000000-0000-4000-8000-0000000000c3";
const DAVE = "00000000-0000-4000-8000-0000000000d4";
const ERIN = "00000000-0000-4000-8000-0000000000e5";
const FRANK = "00000000-0000-4000-8000-0000000000f6";
const GRACE = "00000000-0000-4000-8000-0000000000a7";
const LOCK_PK = "LITELLM#USERSYNC";
const SSO_SENTINEL = "sso-sentinel-0451";

const ENG = { departmentId: "dept-eng", departmentName: "Engineering" };
const accounts = [
  makeAccount(1, { teamId: "team-a", teamName: "A", ...ENG }),
  makeAccount(2, { teamId: "team-b", teamName: "B", ...ENG }),
  makeAccount(3, { teamId: "team-c", teamName: "C", ...ENG }),
];

let state: SyncFakeState;
let fake: ReturnType<typeof installSyncFake>;
let seedCount = 0;
const seedCtx = () =>
  ctxAt(new Date("2026-01-02T03:04:05.000Z"), `req-seed-${++seedCount}`);

async function storeConnection() {
  await testDoc().send(
    new PutCommand({
      TableName: TEST_TABLE_NAME,
      Item: {
        PK: "LITELLM#CONFIG",
        SK: "CONNECTION",
        baseUrl: "http://litellm.test:4000",
        version: 1,
        updatedAt: "2026-11-14T10:00:00.000Z",
      },
    }),
  );
}

beforeAll(ensureTestTable);
beforeEach(async () => {
  await clearTable();
  hook.before = null;
  hook.after = null;
  hook.sent.length = 0;
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  stubSyncEnv(ENTRA_ISSUER);
  await storeConnection();
  await loadFixtures({ accounts });
  state = newSyncState();
  fake = installSyncFake(state);
});
afterEach(() => {
  // T-SY11 (user, 2026-11-18: "It should not remove users from litellm"): the
  // run made only GETs of /user/list, /user/info and /team/info.
  expect(nonReadCalls(fake)).toEqual([]);
  vi.useRealTimers();
});

type RunInput = {
  actor: string;
  trigger: "manual" | "schedule";
  mode: "preview" | "apply";
  planHash?: string;
};
async function run(input: RunInput): Promise<RunView> {
  const mod = await import("./run");
  return (await mod.runLiteLLMUserSync(input)) as unknown as RunView;
}
type Runner = { name: string; actor: string; trigger: "manual" | "schedule" };
const ADMIN_RUN: Runner = {
  name: "manual apply",
  actor: ADMIN,
  trigger: "manual",
};
const SCHEDULE_RUN: Runner = {
  name: "scheduled run (T-SY12)",
  actor: "system",
  trigger: "schedule",
};

const hashOf = (view: RunView): string => {
  const hash = view.value?.plan?.planHash;
  if (!hash)
    throw new Error(`no plan hash in the result: ${JSON.stringify(view)}`);
  return hash;
};
const preview = (r: Runner = ADMIN_RUN) =>
  run({ actor: r.actor, trigger: r.trigger, mode: "preview" });
// A manual run previews, then applies that plan's hash; the schedule applies.
async function sync(r: Runner = ADMIN_RUN): Promise<RunView> {
  if (r.trigger === "schedule") {
    return run({ actor: r.actor, trigger: "schedule", mode: "apply" });
  }
  const planned = await preview(r);
  return run({
    actor: r.actor,
    trigger: "manual",
    mode: "apply",
    planHash: hashOf(planned),
  });
}
const rowOf = (view: RunView, litellmUserId: string) =>
  view.value?.plan?.users.find((u) => u.litellmUserId === litellmUserId);

// ---------------------------------------------------------------- fixtures --

type Person = { oid: string; upn: string; name: string };
const PEOPLE = {
  admin: { oid: ADMIN, upn: "admin@corp.example", name: "Admin" },
  alice: { oid: ALICE, upn: "alice@corp.example", name: "Alice" },
  bob: { oid: BOB, upn: "bob@corp.example", name: "Bob" },
  carol: { oid: CAROL, upn: "carol@corp.example", name: "Carol" },
  dave: { oid: DAVE, upn: "dave@corp.example", name: "Dave" },
  erin: { oid: ERIN, upn: "erin@corp.example", name: "Erin" },
  frank: { oid: FRANK, upn: "frank@corp.example", name: "Frank" },
  grace: { oid: GRACE, upn: "grace@corp.example", name: "Grace" },
} satisfies Record<string, Person>;

async function seedPerson(p: Person, over: { email?: string } = {}) {
  await seedSignedIn(p.oid, {
    upn: p.upn,
    email: over.email ?? p.upn,
    displayName: p.name,
  });
}

function lite(
  userId: string,
  email: string | null,
  over: Partial<SyncFakeUser> = {},
): SyncFakeUser {
  const user: SyncFakeUser = { userId, email, ...over };
  state.users.push(user);
  return user;
}
function addToTeam(
  litellmTeamId: string,
  user: SyncFakeUser,
  role: "user" | "admin" = "user",
) {
  (state.teams[litellmTeamId] ??= { members: [] }).members.push({
    userId: user.userId,
    email: user.email,
    role,
  });
  user.teams = [...(user.teams ?? []), litellmTeamId];
}
async function linkTeam(teamId: string, litellmTeamId: string) {
  ok(await putTeamLink({ teamId, litellmTeamId, version: null }, seedCtx()));
}

const successRecords = async () =>
  (await listAuditRecords(DAY)).filter((r) => r.result === "success");
const byAction = async (action: string) =>
  (await successRecords()).filter((r) => r.action === action);
const runIdOf = (r: { requestId: string; after?: Record<string, unknown> }) =>
  String(r.after?.runId ?? r.requestId);
const pendingItems = async () =>
  (await allItems()).filter((i) => i.SK === "LITELLMLINK");

async function lockItem() {
  const res = await testDoc().send(
    new GetCommand({
      TableName: TEST_TABLE_NAME,
      Key: { PK: LOCK_PK, SK: "LOCK" },
    }),
  );
  return res.Item;
}
const putLock = (owner: string, leaseUntil: Date) =>
  testDoc().send(
    new PutCommand({
      TableName: TEST_TABLE_NAME,
      Item: {
        PK: LOCK_PK,
        SK: "LOCK",
        owner,
        leaseUntil: leaseUntil.toISOString(),
        expiresAt: Math.floor(leaseUntil.getTime() / 1000) + 600,
      },
    }),
  );
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

// --------------------------------------------------------------- T-SY1 -----

describe("T-SY1: links on an exact match", () => {
  it("links on the email, case-folded: mode sync, the claim, one record with the matched key and the actor", async () => {
    await seedPerson(PEOPLE.alice);
    lite("lu-alice", "Alice@Corp.Example");

    const result = await sync();

    expect(result.ok).toBe(true);
    const link = await getIdentityLink(ALICE);
    expect(link?.litellmUserId).toBe("lu-alice");
    expect(await getLiteLLMUserOwner("lu-alice")).toBe(ALICE);
    const records = await byAction("identity.litellm-link.set");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      actor: ADMIN,
      target: { type: "identity", id: ALICE },
    });
    expect(records[0]?.after).toMatchObject({
      mode: "sync",
      litellmUserId: "lu-alice",
      matchedKey: "email",
    });
  });

  it.each([
    ["user_id", { userId: ALICE }],
    ["sso_user_id", { userId: "lu-sso", ssoUserId: ALICE }],
  ])(
    "links on the Entra id (%s equals the oid) whatever the email says",
    async (_name, over) => {
      await seedPerson(PEOPLE.alice);
      lite(over.userId, "someone.else@elsewhere.test", over);

      await sync();

      expect((await getIdentityLink(ALICE))?.litellmUserId).toBe(over.userId);
      const [record] = await byAction("identity.litellm-link.set");
      expect(record?.after).toMatchObject({
        mode: "sync",
        matchedKey: "oid",
      });
    },
  );

  it("matches the UPN, never the email claim (T-SM1)", async () => {
    await seedPerson(PEOPLE.alice, { email: "claim@corp.example" });
    lite("lu-claim", "claim@corp.example");

    const result = await sync();

    expect(rowOf(result, "lu-claim")?.outcome).toBe("create-pending");
    expect(await getIdentityLink(ALICE)).toBeNull();
  });

  it("a guest UPN never matches, and neither does an identity of another tenant (T-SM1)", async () => {
    const guestUpn = "jane_corp.example#EXT#@contoso.onmicrosoft.com";
    await seedSignedIn(CAROL, { upn: guestUpn, email: "jane@corp.example" });
    await seedSignedIn(DAVE, {
      upn: "dave@corp.example",
      tid: "22222222-2222-4222-8222-222222222222",
    });
    lite("lu-guest", guestUpn);
    lite("lu-guest-email", "jane@corp.example");
    lite("lu-dave", "dave@corp.example");

    await sync();

    expect(await getIdentityLink(CAROL)).toBeNull();
    expect(await getIdentityLink(DAVE)).toBeNull();
  });

  it("the two keys pointing at different people link nothing: ambiguous-identity", async () => {
    await seedPerson(PEOPLE.alice);
    await seedPerson(PEOPLE.bob);
    lite("lu-split", "bob@corp.example", { ssoUserId: ALICE });

    const result = await sync();

    expect(rowOf(result, "lu-split")).toMatchObject({
      outcome: "skip",
      reason: "ambiguous-identity",
    });
    expect(await getIdentityLink(ALICE)).toBeNull();
    expect(await getIdentityLink(BOB)).toBeNull();
    expect(await getLiteLLMUserOwner("lu-split")).toBeNull();
  });

  it("a prefix, a suffix, another domain never link; a display name is no email", async () => {
    await seedPerson(PEOPLE.alice);
    lite("lu-prefix", "alice@corp.example.org");
    lite("lu-suffix", "malice@corp.example");
    lite("lu-domain", "alice@other.example");
    lite("lu-name", "Alice Anderson");

    const result = await sync();

    expect(await getIdentityLink(ALICE)).toBeNull();
    expect(
      ["lu-prefix", "lu-suffix", "lu-domain"].map(
        (id) => rowOf(result, id)?.outcome,
      ),
    ).toEqual(["create-pending", "create-pending", "create-pending"]);
    expect(rowOf(result, "lu-name")).toMatchObject({
      outcome: "skip",
      reason: "no-email",
    });
  });

  it("refusals write no link, no claim and no pending link", async () => {
    await seedPerson(PEOPLE.dave);
    await seedPerson(PEOPLE.erin);
    await seedPerson(PEOPLE.frank);
    await seedPerson(PEOPLE.grace);
    await seedPerson(PEOPLE.bob);
    lite("lu-admin", "dave@corp.example", { role: "proxy_admin" });
    lite("lu-viewer", "no-person@corp.example", { role: "proxy_admin_viewer" });
    lite("lu-weird", "no-person-2@corp.example", {
      role: "a-role-nobody-knows",
    });
    lite("lu-erin-a", "erin@corp.example");
    lite("lu-erin-b", "ERIN@corp.example");
    lite("lu-frank", "frank@corp.example");
    ok(
      await writeLiteLLMUserLink(
        {
          oid: BOB,
          version: null,
          write: {
            kind: "set",
            litellmUserId: "lu-frank",
            mode: "manual",
            reason: "seeded for the claimed case",
          },
        },
        seedCtx(),
      ),
    );
    ok(
      await writeLiteLLMUserLink(
        {
          oid: GRACE,
          version: null,
          write: {
            kind: "set",
            litellmUserId: "lu-grace-old",
            mode: "manual",
            reason: "seeded for the linked-elsewhere case",
          },
        },
        seedCtx(),
      ),
    );
    lite("lu-grace-new", "grace@corp.example");

    const result = await sync();

    expect(
      Object.fromEntries(
        [
          "lu-admin",
          "lu-viewer",
          "lu-weird",
          "lu-erin-a",
          "lu-erin-b",
          "lu-frank",
          "lu-grace-new",
        ].map((id) => [id, rowOf(result, id)?.reason]),
      ),
    ).toEqual({
      "lu-admin": "privileged",
      "lu-viewer": "privileged",
      "lu-weird": "privileged",
      "lu-erin-a": "duplicate-email",
      "lu-erin-b": "duplicate-email",
      "lu-frank": "claimed",
      "lu-grace-new": "identity-linked-elsewhere",
    });
    expect(await pendingItems()).toEqual([]);
    for (const id of [
      "lu-admin",
      "lu-viewer",
      "lu-weird",
      "lu-erin-a",
      "lu-erin-b",
      "lu-grace-new",
    ]) {
      expect(await getLiteLLMUserOwner(id)).toBeNull();
    }
    expect(await getLiteLLMUserOwner("lu-frank")).toBe(BOB);
    expect((await getIdentityLink(DAVE))?.litellmUserId).toBeUndefined();
    expect((await getIdentityLink(ERIN))?.litellmUserId).toBeUndefined();
    expect((await getIdentityLink(FRANK))?.litellmUserId).toBeUndefined();
    expect((await getIdentityLink(GRACE))?.litellmUserId).toBe("lu-grace-old");
  });

  it("a link to a LiteLLM user that is gone from LiteLLM is kept (S22: nothing is removed)", async () => {
    await seedPerson(PEOPLE.grace);
    ok(
      await writeLiteLLMUserLink(
        {
          oid: GRACE,
          version: null,
          write: {
            kind: "set",
            litellmUserId: "lu-gone",
            mode: "manual",
            reason: "seeded",
          },
        },
        seedCtx(),
      ),
    );

    await sync();

    expect((await getIdentityLink(GRACE))?.litellmUserId).toBe("lu-gone");
    expect(await getLiteLLMUserOwner("lu-gone")).toBe(GRACE);
  });

  it("a person nobody matches gets a pending link and a claim, and no sign-in", async () => {
    lite("lu-new", "New.Hire@Corp.Example");
    const identitiesBefore = await keysWhere(isIdentityMeta);

    await sync();

    const items = await pendingItems();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      PK: "PENDING#new.hire@corp.example",
      litellmUserId: "lu-new",
      source: "sync",
    });
    expect(await getLiteLLMUserOwner("lu-new")).not.toBeNull();
    const [record] = await byAction("identity.litellm-pending.set");
    expect(record).toMatchObject({ actor: ADMIN });
    expect(await keysWhere(isIdentityMeta)).toEqual(identitiesBefore);
  });

  it("running twice changes nothing the second time (already-linked, already-pending)", async () => {
    await seedPerson(PEOPLE.alice);
    lite("lu-alice", "alice@corp.example");
    lite("lu-new", "new@corp.example");
    await sync();
    const stored = async () =>
      (await allItems())
        .map(keyOf)
        .filter((k) => !k.startsWith("AUDIT#"))
        .sort();
    const before = await stored();

    const second = await sync();

    expect(rowOf(second, "lu-alice")?.outcome).toBe("already-linked");
    expect(rowOf(second, "lu-new")?.outcome).toBe("already-pending");
    expect(await stored()).toEqual(before);
    expect(await byAction("identity.litellm-link.set")).toHaveLength(1);
    expect(await byAction("identity.litellm-pending.set")).toHaveLength(1);
  });

  it("never returns or logs sso_user_id (S20; T-SY1)", async () => {
    await seedPerson(PEOPLE.alice);
    lite("lu-match-1", "else@elsewhere.test", { ssoUserId: ALICE });
    lite("lu-priv-1", "x@corp.example", {
      role: "proxy_admin",
      ssoUserId: SSO_SENTINEL,
    });
    const logs = [
      vi.spyOn(console, "log"),
      vi.spyOn(console, "info"),
      vi.spyOn(console, "warn"),
      vi.spyOn(console, "error"),
      vi.spyOn(console, "debug"),
    ];
    for (const spy of logs) spy.mockImplementation(() => undefined);
    const out = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const err = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    const result = await sync();

    const printed = [...logs, out, err]
      .flatMap((s) => s.mock.calls.map((c) => c.map(String).join(" ")))
      .join("\n");
    expect(JSON.stringify(result)).not.toMatch(/sso/i);
    expect(JSON.stringify(result)).not.toContain(SSO_SENTINEL);
    expect(printed).not.toContain(SSO_SENTINEL);
    expect(JSON.stringify(await listAuditRecords(DAY))).not.toContain(
      SSO_SENTINEL,
    );
  });

  // Access Control - LiteLLM user sync, ~line 1033: `sso_user_id` is "never
  // returned, logged or stored in clear"; a non-email placeholder is keyed
  // `PENDING#sso:<sha256 hex of the lower-cased sso_user_id>`, an email one
  // keeps `PENDING#{email}` (S20, T-SY1, T-SY6, T-SY10).
  it("keys an SSO placeholder by the hash and stores, returns and audits no raw reference; an email placeholder keeps its email (S20, T-SY1)", async () => {
    const sso = "SSO-Store-Sentinel-88";
    const key = `sso:${createHash("sha256").update(sso.toLowerCase()).digest("hex")}`;
    lite("lu-sso-key", "has.sso@corp.example", { ssoUserId: sso });
    lite("lu-mail-key", "plain.mail@corp.example");

    const first = await sync();

    const pending = await pendingItems();
    expect(pending.map((i) => i.PK).sort()).toEqual(
      ["PENDING#plain.mail@corp.example", `PENDING#${key}`].sort(),
    );
    const ssoItem = pending.find((i) => i.PK === `PENDING#${key}`);
    expect(ssoItem).toMatchObject({
      emailOrOid: key,
      litellmUserId: "lu-sso-key",
    });
    const claim = (await allItems()).find(
      (i) => i.PK === "LITELLMUSER#lu-sso-key",
    );
    expect(claim).toMatchObject({ oid: key });

    const everywhere = JSON.stringify([
      await allItems(),
      await listAuditRecords(DAY),
      first,
    ]).toLowerCase();
    expect(everywhere).not.toContain("sso-store-sentinel");

    const second = await sync();
    expect(rowOf(second, "lu-sso-key")?.outcome).toBe("already-pending");
    expect(await byAction("identity.litellm-pending.set")).toHaveLength(2);
  });

  it("the set and remove records of an SSO placeholder carry no raw reference (S20, T-SY10)", async () => {
    const sso = "SSO-Audit-Sentinel-52";
    lite("lu-sso-aud", "audit.sso@corp.example", { ssoUserId: sso });
    await sync();
    const { removePendingLiteLLMLink, listPendingLiteLLMLinks } =
      await import("@/lib/data/access/pending-litellm-links");
    const [link] = await listPendingLiteLLMLinks();
    expect(link?.litellmUserId).toBe("lu-sso-aud");
    await removePendingLiteLLMLink(
      {
        emailOrOid: link?.emailOrOid ?? "",
        version: link?.version ?? 0,
        runId: "run-remove",
      },
      {
        actor: ADMIN,
        requestId: "req-remove",
        now: new Date(),
        sequence: { next: 0 },
      },
    );
    const records = (await listAuditRecords(DAY)).filter((r) =>
      r.action.startsWith("identity.litellm-pending."),
    );
    expect(records.map((r) => r.action).sort()).toEqual([
      "identity.litellm-pending.remove",
      "identity.litellm-pending.set",
    ]);
    expect(JSON.stringify(records).toLowerCase()).not.toContain(
      "sso-audit-sentinel",
    );
  });
});

// --------------------------------------------------------------- T-SM2 -----

describe("T-SM2: a password user is matched by sign-in email and by the reserved expected oid", () => {
  async function addPasswordUser(
    email: string,
    expectedOid?: string,
  ): Promise<string> {
    const created = ok(
      await createPasswordUser(
        {
          email,
          displayName: "Pat",
          ...(expectedOid ? { sso: { expectedOid } } : {}),
        },
        seedCtx(),
      ),
    );
    return created.user.oid;
  }

  it("links the person added by hand by the sign-in email, not as a second 'not signed in yet' person", async () => {
    const oid = await addPasswordUser("pw@corp.example");
    lite("lu-pw", "PW@corp.example");

    await sync();

    expect(oid.startsWith("local:")).toBe(true);
    expect((await getIdentityLink(oid))?.litellmUserId).toBe("lu-pw");
    expect(await pendingItems()).toEqual([]);
  });

  it("links by the reserved expected oid when the emails differ", async () => {
    const oid = await addPasswordUser("pw2@corp.example", ALICE);
    lite("lu-pw2", "other@elsewhere.test", { ssoUserId: ALICE });

    await sync();

    expect((await getIdentityLink(oid))?.litellmUserId).toBe("lu-pw2");
  });

  it("never compares a local: id with a LiteLLM id", async () => {
    const oid = await addPasswordUser("pw3@corp.example");
    lite(oid, "unrelated@elsewhere.test");

    const result = await sync();

    expect(await getIdentityLink(oid)).toBeNull();
    expect(rowOf(result, oid)?.outcome).not.toBe("link-existing");
  });
});

// --------------------------------------------------------------- T-SY2 -----

// The seed writes account META items and a dev team-lead identity with its own
// ADMINSCOPE, so "the sync writes none" compares against a baseline.
const keysWhere = async (
  match: (i: Record<string, unknown>) => boolean,
): Promise<string[]> => (await allItems()).filter(match).map(keyOf).sort();
const isIdentityMeta = (i: Record<string, unknown>) =>
  i.SK === "META" && String(i.PK).startsWith("IDENT#");
const isAdminScope = (i: Record<string, unknown>) =>
  String(i.SK).startsWith("ADMINSCOPE#");

describe("T-SY2: the sync grants no role, no scope and creates no sign-in", () => {
  it("a LiteLLM team admin becomes a member and nothing else", async () => {
    await seedPerson(PEOPLE.alice);
    await linkTeam("team-a", "lt-a");
    addToTeam("lt-a", lite("lu-alice", "alice@corp.example"), "admin");
    addToTeam("lt-a", lite("lu-new", "new@corp.example"), "admin");
    const identitiesBefore = await keysWhere(isIdentityMeta);
    const scopesBefore = await keysWhere(isAdminScope);

    await sync();

    expect((await getAffiliation(ALICE))?.teamId).toBe("team-a");
    expect(
      ok(await listAdminScopes(ALICE, { cursorSecret: CURSOR_SECRET })).items,
    ).toEqual([]);
    const after = await allItems();
    expect(after.filter((i) => String(i.SK).startsWith("ROLEGRANT#"))).toEqual(
      [],
    );
    expect(after.filter(isAdminScope).map(keyOf).sort()).toEqual(scopesBefore);
    expect(after.filter((i) => String(i.PK).startsWith("LOCALUSER#"))).toEqual(
      [],
    );
    expect(after.filter((i) => String(i.PK).startsWith("SETUPLINK#"))).toEqual(
      [],
    );
    expect(after.filter(isIdentityMeta).map(keyOf).sort()).toEqual(
      identitiesBefore,
    );
  });
});

// ------------------------------------------------ T-SY3 / T-SY12 teams ------

describe.each([ADMIN_RUN, SCHEDULE_RUN])("teams: $name", (runner) => {
  async function alice() {
    await seedPerson(PEOPLE.alice);
    return lite("lu-alice", "alice@corp.example");
  }
  const unplacedOf = (view: RunView) =>
    Object.fromEntries(
      (view.value?.unplaced ?? []).map((u) => [u.litellmUserId, u.reason]),
    );

  it("exactly one linked team: member of it, audited with the run's actor", async () => {
    await linkTeam("team-a", "lt-a");
    addToTeam("lt-a", await alice());

    const result = await sync(runner);

    expect(result.ok).toBe(true);
    expect(await getAffiliation(ALICE)).toMatchObject({
      teamId: "team-a",
      createdBy: runner.actor,
    });
    const records = await byAction("affiliation.add");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      actor: runner.actor,
      teamId: "team-a",
      target: { type: "identity", id: ALICE },
    });
  });

  it("never a lead: a LiteLLM team admin is a member, with no scope and no grant", async () => {
    await linkTeam("team-a", "lt-a");
    addToTeam("lt-a", await alice(), "admin");

    await sync(runner);

    expect((await getAffiliation(ALICE))?.teamId).toBe("team-a");
    expect(
      ok(await listAdminScopes(ALICE, { cursorSecret: CURSOR_SECRET })).items,
    ).toEqual([]);
    expect(
      (await allItems()).filter((i) => String(i.SK).startsWith("ROLEGRANT#")),
    ).toEqual([]);
  });

  it("two or more candidate teams: nobody is placed, and the person is named", async () => {
    await linkTeam("team-a", "lt-a");
    await linkTeam("team-b", "lt-b");
    const user = await alice();
    addToTeam("lt-a", user);
    addToTeam("lt-b", user);

    const result = await sync(runner);

    expect(await getAffiliation(ALICE)).toBeNull();
    expect(unplacedOf(result)).toEqual({ "lu-alice": "multiple-teams" });
  });

  it("an affiliation elsewhere is not moved (other-team), and the person is named", async () => {
    await linkTeam("team-a", "lt-a");
    ok(await addMember({ oid: ALICE, teamId: "team-b" }, seedCtx()));
    await seedPerson(PEOPLE.alice);
    const user = lite("lu-alice", "alice@corp.example");
    addToTeam("lt-a", user);
    const before = await getAffiliation(ALICE);

    const result = await sync(runner);

    expect(await getAffiliation(ALICE)).toEqual(before);
    expect(unplacedOf(result)).toEqual({ "lu-alice": "other-team" });
  });

  it("an SSO-sourced affiliation is never touched", async () => {
    await linkTeam("team-a", "lt-a");
    await seedSsoAffiliation(ALICE, "team-b");
    addToTeam("lt-a", await alice());
    const before = await getAffiliation(ALICE);

    const result = await sync(runner);

    expect(await getAffiliation(ALICE)).toEqual(before);
    expect(before?.source).toBe("sso");
    expect(unplacedOf(result)).toEqual({ "lu-alice": "other-team" });
  });

  it("already a member of that team: nothing is written for the membership", async () => {
    await linkTeam("team-a", "lt-a");
    await seedPerson(PEOPLE.alice);
    ok(await addMember({ oid: ALICE, teamId: "team-a" }, seedCtx()));
    addToTeam("lt-a", lite("lu-alice", "alice@corp.example"));
    const before = await getAffiliation(ALICE);

    const result = await sync(runner);

    expect(await getAffiliation(ALICE)).toEqual(before);
    expect(await byAction("affiliation.add")).toEqual([]);
    expect(unplacedOf(result)).toEqual({});
  });

  it("a team with no team link places nobody; the person is named (no-linked-team)", async () => {
    const user = await alice();
    state.teams["lt-c"] = { members: [] };
    addToTeam("lt-c", user);

    const result = await sync(runner);

    expect(await getAffiliation(ALICE)).toBeNull();
    expect(unplacedOf(result)).toEqual({ "lu-alice": "no-linked-team" });
  });

  it("a team link whose LiteLLM team no longer exists places nobody and does not fail the run", async () => {
    await linkTeam("team-a", "lt-gone");
    const user = await alice();
    user.teams = ["lt-gone"];

    const result = await sync(runner);

    expect(result.ok).toBe(true);
    expect(await getAffiliation(ALICE)).toBeNull();
  });

  it("an app team unknown to the directory places nobody", async () => {
    await linkTeam("ghost-team", "lt-ghost");
    addToTeam("lt-ghost", await alice());

    await sync(runner);

    expect(await getAffiliation(ALICE)).toBeNull();
  });

  it("nothing is ever removed: a member missing from the LiteLLM team stays, reported as drift", async () => {
    await linkTeam("team-a", "lt-a");
    await seedPerson(PEOPLE.bob);
    ok(await addMember({ oid: BOB, teamId: "team-a" }, seedCtx()));
    state.teams["lt-a"] = { members: [] };
    const before = await getAffiliation(BOB);

    const planned = await preview(runner);
    await sync(runner);

    expect(await getAffiliation(BOB)).toEqual(before);
    expect(await byAction("affiliation.remove")).toEqual([]);
    expect(planned.value?.plan?.drift?.map((d) => d.oid)).toContain(BOB);
  });

  it("a person not signed in yet, in exactly one linked team, gets a pending affiliation and no sign-in", async () => {
    await linkTeam("team-a", "lt-a");
    addToTeam("lt-a", lite("lu-new", "New@Corp.Example"));
    const identitiesBefore = await keysWhere(isIdentityMeta);

    await sync(runner);

    const pending = await listPendingFor(["new@corp.example"]);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ kind: "affiliation", teamId: "team-a" });
    expect(await keysWhere(isIdentityMeta)).toEqual(identitiesBefore);
  });

  it("a person not signed in yet, in two linked teams, is placed nowhere", async () => {
    await linkTeam("team-a", "lt-a");
    await linkTeam("team-b", "lt-b");
    const user = lite("lu-new", "new@corp.example");
    addToTeam("lt-a", user);
    addToTeam("lt-b", user);

    const result = await sync(runner);

    expect(await listPendingFor(["new@corp.example"])).toEqual([]);
    expect(unplacedOf(result)).toEqual({ "lu-new": "multiple-teams" });
    expect(await pendingItems()).toHaveLength(1);
  });
});

// --------------------------------------------------------------- T-SY4 -----

describe("T-SY4: the caller's own identity", () => {
  it("is own-identity for the link and for the membership (manual run)", async () => {
    await seedPerson(PEOPLE.admin);
    await linkTeam("team-a", "lt-a");
    addToTeam("lt-a", lite("lu-admin-self", "admin@corp.example"));

    const result = await sync(ADMIN_RUN);

    expect(rowOf(result, "lu-admin-self")).toMatchObject({
      outcome: "skip",
      reason: "own-identity",
    });
    expect(await getIdentityLink(ADMIN)).toBeNull();
    expect(await getAffiliation(ADMIN)).toBeNull();
  });
});

// --------------------------------------------------------------- T-SY5 -----

describe("T-SY5: the plan hash and the lease", () => {
  it("the same LiteLLM state gives the same hash, whatever the order of its users", async () => {
    lite("lu-1", "one@corp.example");
    lite("lu-2", "two@corp.example");
    lite("lu-3", "three@corp.example");
    const first = hashOf(await preview());
    state.users.reverse();

    expect(hashOf(await preview())).toBe(first);
  });

  it("another hash is PLAN_CHANGED and writes nothing", async () => {
    lite("lu-1", "one@corp.example");
    const planned = hashOf(await preview());
    lite("lu-2", "two@corp.example");

    const result = await run({
      actor: ADMIN,
      trigger: "manual",
      mode: "apply",
      planHash: planned,
    });

    expect(result).toMatchObject({ ok: false, code: "PLAN_CHANGED" });
    expect(await pendingItems()).toEqual([]);
    expect(await successRecords()).toEqual([]);
  });

  it("a lease held by another run is SYNC_RUNNING and writes nothing", async () => {
    lite("lu-1", "one@corp.example");
    const planned = hashOf(await preview());
    await putLock("another-run", minutes(3));

    const result = await run({
      actor: ADMIN,
      trigger: "manual",
      mode: "apply",
      planHash: planned,
    });

    expect(result).toMatchObject({ ok: false, code: "SYNC_RUNNING" });
    expect(await pendingItems()).toEqual([]);
    expect((await lockItem())?.owner).toBe("another-run");
  });

  it("a lease that has passed is taken over, and the lease is released after the run", async () => {
    lite("lu-1", "one@corp.example");
    await putLock("dead-run", minutes(-1));

    const result = await sync();

    expect(result.ok).toBe(true);
    expect(await pendingItems()).toHaveLength(1);
    expect(await lockItem()).toBeUndefined();
  });

  it("the preview takes no lease and writes nothing", async () => {
    await seedPerson(PEOPLE.alice);
    lite("lu-alice", "alice@corp.example");
    lite("lu-new", "new@corp.example");
    const before = (await allItems()).map(keyOf).sort();
    hook.sent.length = 0;

    const result = await preview();

    expect(result.ok).toBe(true);
    expect((await allItems()).map(keyOf).sort()).toEqual(before);
    expect(
      hook.sent.filter((c) =>
        [
          "PutCommand",
          "UpdateCommand",
          "DeleteCommand",
          "TransactWriteCommand",
        ].includes(c.name),
      ),
    ).toEqual([]);
  });

  it("two applies at once: one wins, each change is written once", async () => {
    for (let i = 0; i < 5; i += 1) lite(`lu-${i}`, `p${i}@corp.example`);
    const planned = hashOf(await preview());
    const input: RunInput = {
      actor: ADMIN,
      trigger: "manual",
      mode: "apply",
      planHash: planned,
    };

    const results = await Promise.all([run(input), run(input)]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const refused = results.find((r) => !r.ok);
    expect(["SYNC_RUNNING", "PLAN_CHANGED"]).toContain(refused?.code);
    expect(await pendingItems()).toHaveLength(5);
    expect(await byAction("identity.litellm-pending.set")).toHaveLength(5);
  });

  it("the lease is renewed before the writes (take, renew, release)", async () => {
    for (let i = 0; i < 3; i += 1) lite(`lu-${i}`, `p${i}@corp.example`);
    const planned = hashOf(await preview());
    hook.sent.length = 0;

    await run({
      actor: ADMIN,
      trigger: "manual",
      mode: "apply",
      planHash: planned,
    });

    const leaseWrites = hook.sent.filter(
      (c) =>
        [
          "PutCommand",
          "UpdateCommand",
          "DeleteCommand",
          "TransactWriteCommand",
        ].includes(c.name) && JSON.stringify(c.input).includes(LOCK_PK),
    );
    expect(leaseWrites.length).toBeGreaterThanOrEqual(3);
  });

  it("a run that has lost its lease stops: no change, one summary saying lost-lease, SYNC_RUNNING, the other owner keeps it (T-SY5; Access Control - LiteLLM user sync ~1112-1114, T-SY5)", async () => {
    for (let i = 0; i < 3; i += 1) lite(`lu-${i}`, `p${i}@corp.example`);
    const planned = hashOf(await preview());
    let taken = false;
    hook.after = async (name, input) => {
      if (
        taken ||
        name === "GetCommand" ||
        !JSON.stringify(input).includes(LOCK_PK)
      )
        return;
      taken = true;
      await putLock("thief-run", minutes(4));
    };

    const outcome = await run({
      actor: ADMIN,
      trigger: "manual",
      mode: "apply",
      planHash: planned,
    }).then(
      (value) => ({ value }),
      () => ({ value: null }),
    );

    expect(taken).toBe(true);
    expect(outcome.value).toMatchObject({ ok: false, code: "SYNC_RUNNING" });
    expect(await pendingItems()).toEqual([]);
    const summaries = await byAction("litellm.user.sync");
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.after).toMatchObject({
      trigger: "manual",
      skipped: "lost-lease",
    });
    expect((await lockItem())?.owner).toBe("thief-run");
  });
});

// --------------------------------------------------------------- T-SY7 -----

describe("T-SY7: bounds, a truncated plan, LiteLLM down, the removal guard", () => {
  it("reads three pages for 60 users, none beyond, and is not truncated", async () => {
    for (let i = 0; i < 60; i += 1) lite(`lu-${i}`, `p${i}@corp.example`);

    const result = await preview();

    expect([...new Set(pagesRead(fake))].sort((a, b) => a - b)).toEqual([
      1, 2, 3,
    ]);
    expect(result.value?.plan?.truncated).toBe(false);
  });

  it("never reads page 81, marks the plan truncated, and refuses to apply it (PLAN_TRUNCATED)", async () => {
    state.syntheticPages = 100;
    const planned = await preview();

    expect(Math.max(...pagesRead(fake))).toBe(80);
    expect(planned.value?.plan?.truncated).toBe(true);

    const result = await run({
      actor: ADMIN,
      trigger: "manual",
      mode: "apply",
      planHash: hashOf(planned),
    });

    expect(result).toMatchObject({ ok: false, code: "PLAN_TRUNCATED" });
    expect(await pendingItems()).toEqual([]);
    expect(await successRecords()).toEqual([]);
  });

  it("the scheduled run reads up to 400 pages: 100 pages are complete, 450 are truncated", async () => {
    state.syntheticPages = 100;
    const complete = await run({
      actor: "system",
      trigger: "schedule",
      mode: "apply",
    });
    expect(complete.ok).toBe(true);
    expect(Math.max(...pagesRead(fake))).toBe(100);
    expect(await pendingItems()).toHaveLength(100);

    await clearTable();
    await storeConnection();
    fake.calls.length = 0;
    state.syntheticPages = 450;
    const truncated = await run({
      actor: "system",
      trigger: "schedule",
      mode: "apply",
    });

    expect(Math.max(...pagesRead(fake))).toBe(400);
    expect(truncated).toMatchObject({ ok: false, code: "PLAN_TRUNCATED" });
    expect(await pendingItems()).toEqual([]);
  });

  it("applies at most 500 changes and reports what remains; the next run continues", async () => {
    for (let i = 0; i < 505; i += 1) lite(`lu-${i}`, `p${i}@corp.example`);

    const first = await sync();

    expect(first.value?.remaining).toBe(5);
    expect(await pendingItems()).toHaveLength(500);

    const second = await sync();

    expect(second.value?.remaining ?? 0).toBe(0);
    expect(await pendingItems()).toHaveLength(505);
  }, 120_000);

  it("LiteLLM unavailable: an error, no write, no summary", async () => {
    await seedPerson(PEOPLE.alice);
    lite("lu-alice", "alice@corp.example");
    expect((await preview()).ok).toBe(true);
    state.listFails = true;

    await expect(preview()).rejects.toThrow();
    await expect(
      run({
        actor: ADMIN,
        trigger: "manual",
        mode: "apply",
        planHash: "x".repeat(64),
      }),
    ).rejects.toThrow();

    expect(await pendingItems()).toEqual([]);
    expect(await successRecords()).toEqual([]);
  });

  describe("clean-up of dashboard placeholders (nothing is removed from LiteLLM)", () => {
    async function seedPending(count: number) {
      for (let i = 0; i < count; i += 1) lite(`lu-${i}`, `p${i}@corp.example`);
      await sync();
      expect(await pendingItems()).toHaveLength(count);
      fake.calls.length = 0;
    }
    const goneFromLiteLLM = (n: number) => {
      state.users = state.users.slice(n);
    };

    it("a pending link whose LiteLLM user is gone is removed after getUser confirms, with one record each", async () => {
      await seedPending(10);
      goneFromLiteLLM(1);

      await sync();

      expect(await pendingItems()).toHaveLength(9);
      expect(await getLiteLLMUserOwner("lu-0")).toBeNull();
      expect(await byAction("identity.litellm-pending.remove")).toHaveLength(1);
      expect(
        fake.calls.some(
          (c) => c.path === "/user/info" && c.url.includes("user_id=lu-0"),
        ),
      ).toBe(true);
    });

    it("a user the list omitted but getUser still returns is not removed", async () => {
      await seedPending(10);
      state.hiddenFromList.add("lu-0");

      await sync();

      expect(await pendingItems()).toHaveLength(10);
      expect(await byAction("identity.litellm-pending.remove")).toEqual([]);
    });

    it("a pending link whose LiteLLM user has another email, or became privileged, is removed", async () => {
      await seedPending(30);
      const [first, second] = state.users;
      if (first) first.email = "changed@corp.example";
      if (second) second.role = "proxy_admin";

      await sync();

      const keys = (await pendingItems()).map((i) => String(i.PK));
      expect(keys).not.toContain("PENDING#p0@corp.example");
      expect(keys).not.toContain("PENDING#p1@corp.example");
      expect(await getLiteLLMUserOwner("lu-1")).toBeNull();
      expect(
        (await byAction("identity.litellm-pending.remove")).length,
      ).toBeGreaterThanOrEqual(2);
    });

    it("removing 1 of 10 (exactly 10 %) goes ahead; then 1 of 9 (more than 10 %) is held back with removal-guard", async () => {
      await seedPending(10);
      goneFromLiteLLM(1);
      await sync();
      expect(await pendingItems()).toHaveLength(9);

      goneFromLiteLLM(1);
      const guarded = await sync();

      expect(await pendingItems()).toHaveLength(9);
      expect(JSON.stringify(guarded.value)).toContain("removal-guard");
      expect(await byAction("identity.litellm-pending.remove")).toHaveLength(1);
    }, 60_000);

    it("20 of 200 (20, and exactly 10 %) are removed", async () => {
      await seedPending(200);
      goneFromLiteLLM(20);

      const result = await sync();

      expect(await pendingItems()).toHaveLength(180);
      expect(JSON.stringify(result.value)).not.toContain("removal-guard");
    }, 120_000);

    it("21 of 300 (more than 20) removes none and reports removal-guard", async () => {
      await seedPending(300);
      goneFromLiteLLM(21);

      const result = await sync();

      expect(await pendingItems()).toHaveLength(300);
      expect(JSON.stringify(result.value)).toContain("removal-guard");
      expect(await byAction("identity.litellm-pending.remove")).toEqual([]);
    }, 120_000);
  });
});

// -------------------------------------------------------------- T-SY10 -----

describe("T-SY10: records and logs", () => {
  it("one record per change and one summary, all with the run's id; the summary carries trigger, truncated and the plan hash", async () => {
    await seedPerson(PEOPLE.alice);
    await linkTeam("team-a", "lt-a");
    addToTeam("lt-a", lite("lu-alice", "alice@corp.example"));
    lite("lu-new-1", "new1@corp.example");
    lite("lu-new-2", "new2@corp.example");
    const planned = hashOf(await preview());

    const result = await run({
      actor: ADMIN,
      trigger: "manual",
      mode: "apply",
      planHash: planned,
    });

    const records = await successRecords();
    expect(records.map((r) => r.action).sort()).toEqual([
      "affiliation.add",
      "identity.litellm-link.set",
      "identity.litellm-pending.set",
      "identity.litellm-pending.set",
      "litellm.user.sync",
    ]);
    const runId = result.value?.runId;
    expect(typeof runId).toBe("string");
    expect(new Set(records.map(runIdOf))).toEqual(new Set([runId]));
    // Access Control - Records: runId on every record (T-SY10), in `after`.
    const [linkRecord] = await byAction("identity.litellm-link.set");
    expect(linkRecord?.after).toMatchObject({ mode: "sync", runId });
    const [summary] = await byAction("litellm.user.sync");
    expect(summary?.actor).toBe(ADMIN);
    expect(summary?.after).toMatchObject({
      trigger: "manual",
      truncated: false,
      planHash: planned,
    });
  });

  it("a scheduled run is recorded with actor system and trigger schedule", async () => {
    lite("lu-new", "new@corp.example");

    await sync(SCHEDULE_RUN);

    const [change] = await byAction("identity.litellm-pending.set");
    const [summary] = await byAction("litellm.user.sync");
    expect(change?.actor).toBe("system");
    expect(summary).toMatchObject({ actor: "system" });
    expect(summary?.after).toMatchObject({ trigger: "schedule" });
  });

  it("no email in any log line, console call or span", async () => {
    installFakeOtel();
    recordedSpans.length = 0;
    await seedPerson(PEOPLE.alice);
    lite("lu-alice", "alice@corp.example");
    lite("lu-new", "new.person@corp.example");
    const logs = [
      vi.spyOn(console, "log"),
      vi.spyOn(console, "info"),
      vi.spyOn(console, "warn"),
      vi.spyOn(console, "error"),
      vi.spyOn(console, "debug"),
    ];
    for (const spy of logs) spy.mockImplementation(() => undefined);
    const out = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const err = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    await sync();
    state.users = [];
    await sync();

    const printed = [...logs, out, err]
      .flatMap((s) => s.mock.calls.map((c) => c.map(String).join(" ")))
      .join("\n");
    expect(printed).not.toMatch(/@corp\.example/);
    expect(JSON.stringify(recordedSpans)).not.toMatch(/@corp\.example/);
  });

  it("a failure stops the run: the changes already written stay, no summary is written", async () => {
    for (let i = 0; i < 5; i += 1) lite(`lu-${i}`, `p${i}@corp.example`);
    const planned = hashOf(await preview());
    let changes = 0;
    hook.before = async (name, input) => {
      if (name !== "TransactWriteCommand") return;
      if (JSON.stringify(input).includes(LOCK_PK)) return;
      changes += 1;
      if (changes === 3) throw new Error("injected DynamoDB failure");
    };

    await expect(
      run({
        actor: ADMIN,
        trigger: "manual",
        mode: "apply",
        planHash: planned,
      }),
    ).rejects.toThrow();

    expect(await byAction("litellm.user.sync")).toEqual([]);
    const written = await pendingItems();
    expect(written.length).toBeGreaterThanOrEqual(1);
    expect(written.length).toBeLessThan(5);
    expect(await byAction("identity.litellm-pending.set")).toHaveLength(
      written.length,
    );
  });
});

// ------------------------------------------------- T-SY8 contract / T-SY12 --

describe("T-SY12: the scheduled run skips cleanly", () => {
  it("the operation switched off: nothing is read from LiteLLM, nothing is written, the summary says disabled", async () => {
    await testDoc().send(
      new PutCommand({
        TableName: TEST_TABLE_NAME,
        Item: {
          PK: "LITELLM#CONFIG",
          SK: "TOGGLES",
          version: 1,
          toggles: { syncLiteLLMUsers: false },
          updatedAt: "2026-11-14T10:00:00.000Z",
        },
      }),
    );
    lite("lu-new", "new@corp.example");

    const result = await sync(SCHEDULE_RUN);

    expect(result.value?.skipped).toBe("disabled");
    expect(fake.calls).toEqual([]);
    expect(await pendingItems()).toEqual([]);
    const [summary] = await byAction("litellm.user.sync");
    expect(summary?.after).toMatchObject({
      trigger: "schedule",
      skipped: "disabled",
    });
  });

  it("the lease held by another run: nothing is written, the summary says locked", async () => {
    lite("lu-new", "new@corp.example");
    await putLock("another-run", minutes(3));

    const result = await sync(SCHEDULE_RUN);

    expect(result.value?.skipped).toBe("locked");
    expect(await pendingItems()).toEqual([]);
    const [summary] = await byAction("litellm.user.sync");
    expect(summary?.after).toMatchObject({
      trigger: "schedule",
      skipped: "locked",
    });
    expect((await lockItem())?.owner).toBe("another-run");
  });
});
