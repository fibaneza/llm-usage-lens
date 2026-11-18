import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  FOREIGN_TENANT,
  GUEST_UPN,
  JANE_OID,
  KEY,
  OTHER_OID,
  seedAdminScopeInvite,
  seedInvite,
  seedSignedIn,
} from "@/test/support/invite-accept-support";
import { clearTable, ensureTestTable } from "@/test/support/test-support";

vi.mock("@/lib/dynamodb", () =>
  import("@/test/support/access-test-support").then((m) => m.faultyDynamodb()),
);
// The literal matches TENANT in invite-accept-support (a hoisted mock factory
// cannot read imports). A test clears `tenant.issuer` and restores it in
// afterEach to model "no Entra tenant configured".
const tenant = vi.hoisted(() => ({
  issuer:
    "https://login.microsoftonline.com/11111111-1111-4111-8111-111111111111/v2.0" as
      | string
      | undefined,
}));
const TENANT_ISSUER = tenant.issuer;
vi.mock("@/env", async (orig) => {
  const env = { ...(await orig<typeof import("@/env")>()).env };
  Object.defineProperty(env, "AUTH_MICROSOFT_ENTRA_ID_ISSUER", {
    get: () => tenant.issuer,
    enumerable: true,
  });
  return { env };
});

import {
  ACTOR,
  auditRecords,
  ctxAt,
  faults,
  ok,
  resetFaults,
  seedSsoAffiliation,
} from "@/test/support/access-test-support";
import { addMember, getAffiliation } from "./affiliations";
import {
  acceptPendingInvite,
  listInviteCandidates,
  listPendingFor,
  searchInviteDirectory,
} from "./pending";

// Source: docs/specs/2026-11-10-access-control.md - "Accept a pending invite
// (unit INV1)" (Write: one TransactWriteItems - pending delete on `version`,
// affiliation by `oid` conditional on none, `affiliation.invite.accept` audit
// with actor, pending key, team, target oid, reason, result; Target: the
// server-computed candidate list; Refusals), T-INV1, T-INV4, T-INV6, "Audit
// log" (Covered). Assumed API (contract for the developer):
//   acceptPendingInvite({ emailOrUpn, teamId, version, oid, reason }, ctx)
//     -> AccessResult<MemberAffiliation>
//   listInviteCandidates(emailOrUpn) -> Promise<InviteCandidate[]>
//   searchInviteDirectory(query)     -> Promise<InviteCandidate[]>
// The configured tenant is read from the Entra issuer in `@/env`
// (sso-binding precedent).
const REASON = "Confirmed by phone with the invitee";
const accept = (
  over: Partial<Parameters<typeof acceptPendingInvite>[0]> = {},
  requestId = "req-acc",
) =>
  acceptPendingInvite(
    {
      emailOrUpn: KEY,
      teamId: "t1",
      version: 1,
      oid: JANE_OID,
      reason: REASON,
      ...over,
    },
    ctxAt(undefined, requestId),
  );

beforeAll(ensureTestTable);
afterEach(() => {
  tenant.issuer = TENANT_ISSUER;
});
beforeEach(async () => {
  await clearTable();
  resetFaults();
});

describe("acceptPendingInvite", () => {
  it("deletes the pending item, writes the ui affiliation keyed by oid and one affiliation.invite.accept record carrying key, team, oid and reason", async () => {
    await seedInvite(KEY, "t1");
    await seedSignedIn(JANE_OID, { upn: "jane.doe@company.com" });
    const value = ok(await accept());
    expect(value).toMatchObject({
      oid: JANE_OID,
      teamId: "t1",
      source: "ui",
      version: 1,
      createdBy: ACTOR,
    });
    expect(await getAffiliation(JANE_OID)).toEqual(value);
    expect(await listPendingFor([KEY])).toEqual([]);
    const records = (await auditRecords()).filter(
      (r) => r.requestId === "req-acc",
    );
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action: "affiliation.invite.accept",
      category: "change",
      result: "success",
      actor: ACTOR,
      teamId: "t1",
      target: { type: "identity", id: JANE_OID },
    });
    const text = JSON.stringify(records[0]);
    expect(text).toContain(KEY);
    expect(text).toContain(REASON);
  });

  it("leaves a pending admin scope for the same key untouched (member invitations only)", async () => {
    await seedInvite(KEY, "t1");
    await seedAdminScopeInvite(KEY, "team", "t1");
    ok(await accept());
    const left = await listPendingFor([KEY]);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ kind: "adminScope" });
  });

  it("T-INV4: a stale version is CONFLICT and writes nothing", async () => {
    await seedInvite(KEY, "t1");
    const before = (await auditRecords()).length;
    expect(await accept({ version: 2 })).toEqual({
      ok: false,
      code: "CONFLICT",
    });
    expect(await getAffiliation(JANE_OID)).toBeNull();
    expect(await listPendingFor([KEY])).toHaveLength(1);
    expect((await auditRecords()).length).toBe(before);
  });

  it("T-INV4: a second accept of the same invite is CONFLICT; one affiliation, one accept record", async () => {
    await seedInvite(KEY, "t1");
    ok(await accept());
    expect(await accept({}, "req-acc-2")).toEqual({
      ok: false,
      code: "CONFLICT",
    });
    expect(await accept({ oid: OTHER_OID }, "req-acc-3")).toEqual({
      ok: false,
      code: "CONFLICT",
    });
    expect(await getAffiliation(OTHER_OID)).toBeNull();
    const accepts = (await auditRecords()).filter(
      (r) => r.action === "affiliation.invite.accept",
    );
    expect(accepts).toHaveLength(1);
  });

  it("T-INV4: two accepts in flight at once bind once - one ok, one CONFLICT; one affiliation, one accept record", async () => {
    await seedInvite(KEY, "t1");
    const results = await Promise.all([
      accept({}, "req-acc-a"),
      accept({}, "req-acc-b"),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([
      { ok: false, code: "CONFLICT" },
    ]);
    expect(await getAffiliation(JANE_OID)).toMatchObject({ version: 1 });
    expect(await listPendingFor([KEY])).toEqual([]);
    const accepts = (await auditRecords()).filter(
      (r) => r.action === "affiliation.invite.accept",
    );
    expect(accepts).toHaveLength(1);
  });

  it("an invite pending for another team is CONFLICT and writes nothing", async () => {
    await seedInvite(KEY, "t2");
    expect(await accept({ teamId: "t1" })).toEqual({
      ok: false,
      code: "CONFLICT",
    });
    expect(await getAffiliation(JANE_OID)).toBeNull();
    expect(await listPendingFor([KEY])).toHaveLength(1);
  });

  it("T-INV6: a target already in a team is ALREADY_AFFILIATED; the invite stays and nothing is written", async () => {
    await seedInvite(KEY, "t1");
    ok(await addMember({ oid: JANE_OID, teamId: "t9" }, ctxAt()));
    const before = (await auditRecords()).length;
    expect(await accept()).toEqual({ ok: false, code: "ALREADY_AFFILIATED" });
    expect(await getAffiliation(JANE_OID)).toMatchObject({ teamId: "t9" });
    expect(await listPendingFor([KEY])).toHaveLength(1);
    expect((await auditRecords()).length).toBe(before);
  });

  it("T-INV6: a target with an SSO-sourced affiliation is MANAGED_BY_SSO; nothing is written", async () => {
    await seedInvite(KEY, "t1");
    await seedSsoAffiliation(JANE_OID, "t9");
    const before = (await auditRecords()).length;
    expect(await accept()).toEqual({ ok: false, code: "MANAGED_BY_SSO" });
    expect(await getAffiliation(JANE_OID)).toMatchObject({
      teamId: "t9",
      source: "sso",
    });
    expect(await listPendingFor([KEY])).toHaveLength(1);
    expect((await auditRecords()).length).toBe(before);
  });

  it("a downstream failure writes one failed record, rethrows, and leaves the invite", async () => {
    await seedInvite(KEY, "t1");
    faults.transact = true;
    await expect(accept()).rejects.toThrow();
    faults.transact = false;
    expect(await listPendingFor([KEY])).toHaveLength(1);
    expect(await getAffiliation(JANE_OID)).toBeNull();
    const failed = (await auditRecords()).filter((r) => r.result === "failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ action: "affiliation.invite.accept" });
  });
});

describe("listInviteCandidates", () => {
  const ROW_KEYS = ["displayName", "email", "oid", "upn"];

  it("returns the unaffiliated, same-tenant identities matching the key by UPN, guest UPN or stored email, with oid, displayName, upn and email only", async () => {
    await seedSignedIn(JANE_OID, { upn: "JANE@example.com" });
    await seedSignedIn("00000000-0000-4000-8000-0000000003b1", {
      upn: GUEST_UPN,
    });
    await seedSignedIn("00000000-0000-4000-8000-0000000003b2", {
      upn: "jd@company.com",
      email: "Jane@Example.com",
    });
    const rows = await listInviteCandidates(KEY);
    expect(rows.map((r) => r.oid).sort()).toEqual(
      [
        JANE_OID,
        "00000000-0000-4000-8000-0000000003b1",
        "00000000-0000-4000-8000-0000000003b2",
      ].sort(),
    );
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(ROW_KEYS);
    }
    const text = JSON.stringify(rows);
    for (const internal of ["failedAttempts", "lockedUntil", "tid", "roles"]) {
      expect(text).not.toContain(internal);
    }
  });

  it("T-INV1: returns nothing else - not an affiliated identity, another tenant, a non-matching or look-alike guest UPN, or an unrelated person", async () => {
    await seedSignedIn(JANE_OID, { upn: KEY });
    const affiliated = "00000000-0000-4000-8000-0000000003c1";
    await seedSignedIn(affiliated, { upn: KEY });
    ok(await addMember({ oid: affiliated, teamId: "t9" }, ctxAt()));
    await seedSignedIn("00000000-0000-4000-8000-0000000003c2", {
      upn: KEY,
      tid: FOREIGN_TENANT,
    });
    await seedSignedIn("00000000-0000-4000-8000-0000000003c3", {
      upn: "jane_example.com.evil#EXT#@contoso.onmicrosoft.com",
    });
    await seedSignedIn("00000000-0000-4000-8000-0000000003c4", {
      upn: "bob@company.com",
      email: "bob@company.com",
    });
    expect((await listInviteCandidates(KEY)).map((r) => r.oid)).toEqual([
      JANE_OID,
    ]);
  });

  it("an identity holding only an admin scope still has no member team and is a candidate", async () => {
    await seedSignedIn(JANE_OID, { upn: KEY });
    await putScope(JANE_OID);
    expect((await listInviteCandidates(KEY)).map((r) => r.oid)).toEqual([
      JANE_OID,
    ]);
  });

  it("fails closed with no Entra tenant configured: no rows, even for a matching identity (Accept a pending invite, Details: no-tenant decision)", async () => {
    await seedSignedIn(JANE_OID, { upn: KEY });
    tenant.issuer = undefined;
    expect(await listInviteCandidates(KEY)).toEqual([]);
    expect(await searchInviteDirectory("jane")).toEqual([]);
    tenant.issuer = TENANT_ISSUER;
    expect(await listInviteCandidates(KEY)).toHaveLength(1);
  });

  it("returns at most 10 rows", async () => {
    for (let i = 0; i < 12; i += 1) {
      await seedSignedIn(manyOid(400 + i), {
        upn: `u${i}@company.com`,
        email: KEY,
      });
    }
    expect(await listInviteCandidates(KEY)).toHaveLength(10);
  });

  it("is never cached: a person who signs in or joins a team shows on the very next read (Rule 60.10)", async () => {
    expect(await listInviteCandidates(KEY)).toEqual([]);
    await seedSignedIn(JANE_OID, { upn: KEY });
    expect((await listInviteCandidates(KEY)).map((r) => r.oid)).toEqual([
      JANE_OID,
    ]);
    ok(await addMember({ oid: JANE_OID, teamId: "t9" }, ctxAt()));
    expect(await listInviteCandidates(KEY)).toEqual([]);
  });
});

describe("searchInviteDirectory (internal-admin and internal-org-admin pick from the directory)", () => {
  it("matches name, email or UPN case-insensitively, same tenant and unaffiliated only, at most 10", async () => {
    await seedSignedIn(JANE_OID, {
      upn: "jd@company.com",
      displayName: "Jane Doe",
    });
    await seedSignedIn(OTHER_OID, {
      upn: "x@company.com",
      email: "JANE.SMITH@company.com",
    });
    const affiliated = "00000000-0000-4000-8000-0000000003d1";
    await seedSignedIn(affiliated, { displayName: "Jane Affiliated" });
    ok(await addMember({ oid: affiliated, teamId: "t9" }, ctxAt()));
    await seedSignedIn("00000000-0000-4000-8000-0000000003d2", {
      displayName: "Jane Foreign",
      tid: FOREIGN_TENANT,
    });
    await seedSignedIn("00000000-0000-4000-8000-0000000003d3", {
      displayName: "Bob",
    });
    const rows = await searchInviteDirectory("jane");
    expect(rows.map((r) => r.oid).sort()).toEqual([JANE_OID, OTHER_OID].sort());
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual([
        "displayName",
        "email",
        "oid",
        "upn",
      ]);
    }
  });

  it("returns at most 10 rows", async () => {
    for (let i = 0; i < 12; i += 1) {
      await seedSignedIn(manyOid(500 + i), {
        displayName: `Sam ${i}`,
      });
    }
    expect(await searchInviteDirectory("sam")).toHaveLength(10);
  });
});

const manyOid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

async function putScope(oid: string): Promise<void> {
  const { grantAdminScope } = await import("./admin-scopes");
  ok(await grantAdminScope({ oid, scopeType: "team", scopeId: "t1" }, ctxAt()));
}
