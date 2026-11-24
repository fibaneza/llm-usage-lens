import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { resetDeniedAudit } from "@/lib/data/access/audit";
import {
  FOREIGN_TENANT,
  GUEST_UPN,
  JANE_OID,
  KEY,
  LL_USER,
  OTHER_OID,
  candidatesPath,
  installLiteLLM,
  linkIdentityToLiteLLMUser,
  seedLiteLLMConnection,
  seedAdminScopeInvite,
  seedInvite,
  seedSignedIn,
} from "@/test/support/invite-accept-support";
import {
  PEOPLE,
  auditToday,
  expectData,
  expectError,
  expectSameBody,
  invoke,
  nonAuditItems,
  seedMember,
  seedWorld,
  signInAs,
  type CallerName,
} from "@/test/support/matrix-route-support";
import { clearTable, ensureTestTable } from "@/test/support/test-support";

import { GET } from "./route";

// Source: docs/specs/2026-11-10-access-control.md - "Accept a pending invite
// (unit INV1)" (Target: candidates are unaffiliated, signed-in, same-tenant
// identities whose UPN, guest UPN or stored email matches the key;
// internal-admin and internal-org-admin may also pick from the directory),
// "API routes" (GET .../candidates: `?q=` for internal-admin and
// internal-org-admin only; at most 10; oid, display name, UPN and email
// only), "Permission matrix" (accept a pending invite), T-INV1, T-INV5.
// The 401 and no-store cases come from the shared route-contract suite.
// INV2 additions cite "Placing a person by hand" (candidate rows carry `exact`
// and `signal`), T-IV2, T-IV3 and "API routes" (the candidates row).
// Decisions: `?q=` from a lead is ignored (the key candidates are returned);
// from an admin or org-admin it returns the directory matches of `q` instead
// of the key candidates; an unknown key, a key pending for another team, or a
// pending admin scope is the same 404 as an out-of-scope team.
// INV2: the candidate signal reads the LiteLLM user list (a GET on the in-process
// fake); the variables are set before `@/env` is first loaded.
vi.hoisted(() => {
  process.env.LITELLM_SERVICE_KEY = "sk-fake-key-000";
  process.env.LITELLM_ALLOWED_HOSTS = "litellm.test:4000";
});
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});
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

type Signal = "upn" | "guest-upn" | "email" | "litellm-link";
type Candidate = {
  oid: string;
  displayName: string | null;
  upn: string | null;
  email: string | null;
  exact: boolean;
  signal: Signal | null;
};
const NOBODY = "nobody@example.com";

const read = (team: string, key: string, query = "") =>
  invoke(GET, {
    method: "GET",
    path: `${candidatesPath(team, key)}${query}`,
    params: { id: team, key },
  });
const items = async (res: Response) =>
  (await expectData<{ items: Candidate[] }>(res)).items;

beforeAll(ensureTestTable);
afterEach(() => {
  tenant.issuer = TENANT_ISSUER;
});
beforeEach(async () => {
  await clearTable();
  resetDeniedAudit();
  await seedWorld();
  await seedSignedIn(JANE_OID, {
    upn: "jane.doe@company.com",
    email: KEY,
    displayName: "Jane Doe",
  });
  await seedInvite(KEY, "team-a");
  signInAs("admin");
});

const ALLOWED: CallerName[] = [
  "admin",
  "orgAdmin",
  "teamAdminA",
  "deptAdminEng",
];
const REFUSED: CallerName[] = ["memberA", "memberB", "viewerNone", "auditor"];

describe("GET .../pending/[key]/candidates - role x action matrix", () => {
  it.each(ALLOWED)(
    "%s reads { data: { items } } with the matching candidate and only oid, displayName, upn, email",
    async (caller) => {
      signInAs(caller);
      const rows = await items(await read("team-a", KEY));
      expect(rows).toEqual([
        {
          oid: JANE_OID,
          displayName: "Jane Doe",
          upn: "jane.doe@company.com",
          email: KEY,
          // Placing a person by hand; T-IV2: the stored email alone is not exact.
          exact: false,
          signal: "email",
        },
      ]);
      const text = JSON.stringify(rows);
      for (const internal of [
        "failedAttempts",
        "lockedUntil",
        "tid",
        "roles",
      ]) {
        expect(text).not.toContain(internal);
      }
    },
  );

  it.each([
    ["teamAdminA", "team-b"],
    ["deptAdminEng", "team-c"],
  ] as const)(
    "%s reading %s (out of scope) gets the same 404 as a missing key (T-INV5)",
    async (caller, team) => {
      await seedInvite(`oos-${team}@example.com`, team);
      signInAs(caller);
      const outOfScope = await expectError(
        await read(team, `oos-${team}@example.com`),
        404,
        "NOT_FOUND",
      );
      signInAs("admin");
      const missing = await expectError(
        await read("team-a", NOBODY),
        404,
        "NOT_FOUND",
      );
      expectSameBody(outOfScope, missing, team, NOBODY);
    },
  );

  it.each(REFUSED)(
    "%s (no accept permission) gets 403 FORBIDDEN and no data",
    async (caller) => {
      signInAs(caller);
      const res = await expectError(
        await read("team-a", KEY),
        403,
        "FORBIDDEN",
      );
      expect(JSON.stringify(res)).not.toContain(JANE_OID);
    },
  );

  it("a read writes nothing and no audit record", async () => {
    const before = await nonAuditItems();
    await items(await read("team-a", KEY));
    expect(await nonAuditItems()).toEqual(before);
    expect(await auditToday()).toEqual([]);
  });
});

describe("candidate set (T-INV1)", () => {
  it("matches by UPN, guest UPN or stored email, and nothing else: not an affiliated identity, another tenant, a look-alike guest or an unrelated person", async () => {
    const byUpn = "00000000-0000-4000-8000-0000000003e1";
    const byGuest = "00000000-0000-4000-8000-0000000003e2";
    await seedSignedIn(byUpn, { upn: KEY.toUpperCase() });
    await seedSignedIn(byGuest, { upn: GUEST_UPN });
    const affiliated = "00000000-0000-4000-8000-0000000003e3";
    await seedSignedIn(affiliated, { upn: KEY });
    await seedMember(affiliated, "team-c");
    await seedSignedIn("00000000-0000-4000-8000-0000000003e4", {
      upn: KEY,
      tid: FOREIGN_TENANT,
    });
    await seedSignedIn("00000000-0000-4000-8000-0000000003e5", {
      upn: "jane_example.com.evil#EXT#@contoso.onmicrosoft.com",
    });
    await seedSignedIn(PEOPLE.bob.oid, { upn: "bob@company.com" });
    signInAs("teamAdminA");
    const rows = await items(await read("team-a", KEY));
    expect(rows.map((r) => r.oid).sort()).toEqual(
      [JANE_OID, byUpn, byGuest].sort(),
    );
  });

  it("with no Entra tenant configured the read is { items: [] } for a lead and an admin (fail closed; Accept a pending invite, Details: no-tenant decision)", async () => {
    tenant.issuer = undefined;
    for (const caller of ["teamAdminA", "admin"] as const) {
      signInAs(caller);
      expect(await items(await read("team-a", KEY))).toEqual([]);
    }
    expect(await items(await read("team-a", KEY, "?q=jane"))).toEqual([]);
  });

  it("returns at most 10 rows", async () => {
    for (let i = 0; i < 12; i += 1) {
      await seedSignedIn(
        `00000000-0000-4000-8000-${String(600 + i).padStart(12, "0")}`,
        { upn: `m${i}@company.com`, email: KEY },
      );
    }
    expect((await items(await read("team-a", KEY))).length).toBe(10);
  });

  it("is never cached: a person who joins a team drops out on the next read", async () => {
    expect((await items(await read("team-a", KEY))).length).toBe(1);
    await seedMember(JANE_OID, "team-c");
    expect(await items(await read("team-a", KEY))).toEqual([]);
  });

  it("an unknown key, a key pending for another team and a pending admin scope are the same 404", async () => {
    await seedInvite("other@example.com", "team-b");
    await seedAdminScopeInvite("scope@example.com", "team", "team-a");
    const unknown = await expectError(
      await read("team-a", NOBODY),
      404,
      "NOT_FOUND",
    );
    const otherTeam = await expectError(
      await read("team-a", "other@example.com"),
      404,
      "NOT_FOUND",
    );
    const scopeOnly = await expectError(
      await read("team-a", "scope@example.com"),
      404,
      "NOT_FOUND",
    );
    expectSameBody(unknown, otherTeam, "nobody", "other@");
    expectSameBody(unknown, scopeOnly, "scope@");
  });

  it.each(["a\u0001b", "k".repeat(300)])(
    "400 BAD_REQUEST for a malformed path key %j",
    async (key) => {
      await expectError(await read("team-a", key), 400, "BAD_REQUEST");
    },
  );
});

describe("?q= directory search (internal-admin and internal-org-admin only)", () => {
  beforeEach(async () => {
    await seedSignedIn(OTHER_OID, {
      upn: "robert@company.com",
      email: "robert@company.com",
      displayName: "Robert Roe",
    });
  });

  it.each(["admin", "orgAdmin"] as const)(
    "%s with ?q= gets the unaffiliated same-tenant directory matches of q, not the key candidates",
    async (caller) => {
      signInAs(caller);
      const rows = await items(await read("team-a", KEY, "?q=robert"));
      expect(rows.map((r) => r.oid)).toEqual([OTHER_OID]);
      // Placing a person by hand: every row carries the fields; a person who
      // matches the key by nothing is not exact.
      expect(rows[0]).toMatchObject({ exact: false, signal: null });
    },
  );

  it("the directory search is capped at 10 and excludes affiliated and foreign-tenant people", async () => {
    for (let i = 0; i < 12; i += 1) {
      await seedSignedIn(
        `00000000-0000-4000-8000-${String(700 + i).padStart(12, "0")}`,
        { displayName: `Sam ${i}` },
      );
    }
    await seedSignedIn("00000000-0000-4000-8000-0000000007f1", {
      displayName: "Sam Foreign",
      tid: FOREIGN_TENANT,
    });
    expect((await items(await read("team-a", KEY, "?q=sam"))).length).toBe(10);
    const names = (await items(await read("team-a", KEY, "?q=sam"))).map(
      (r) => r.displayName,
    );
    expect(names).not.toContain("Sam Foreign");
  });

  it.each(["teamAdminA", "deptAdminEng"] as const)(
    "%s with ?q= gets the key candidates only: q is ignored and no directory person leaks",
    async (caller) => {
      signInAs(caller);
      const rows = await items(await read("team-a", KEY, "?q=robert"));
      expect(rows.map((r) => r.oid)).toEqual([JANE_OID]);
      expect(JSON.stringify(rows)).not.toContain("Robert");
    },
  );
});

// Source: Access Control - "Placing a person by hand": the dialog preselects a
// target only when its UPN equals the invite key, or it is the identity linked
// to the LiteLLM user that has this email; the link is a candidate signal, never
// a bind key and never a new candidate (the set stays INV1's, so the accept
// route is unchanged); T-IV2 (an unverified LiteLLM email never selects),
// "API routes" (the candidates row: `exact`, `signal`), LiteLLM LD37 (a gateway
// that is not configured is a handled state), threat R1 (the boolean `exact`
// is all of the link that reaches the caller).
describe("candidate signal and exact (Placing a person by hand; T-IV2)", () => {
  const UPN_OID = "00000000-0000-4000-8000-0000000003e1";
  const GUEST_OID = "00000000-0000-4000-8000-0000000003e2";
  const byOid = (rows: Candidate[], oid: string) =>
    rows.find((r) => r.oid === oid);

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("signals: a UPN equal to the key is exact (upn); a guest UPN and a stored email alone are not exact (guest-upn, email)", async () => {
    await seedSignedIn(UPN_OID, { upn: KEY.toUpperCase() });
    await seedSignedIn(GUEST_OID, { upn: GUEST_UPN });
    signInAs("teamAdminA");
    const rows = await items(await read("team-a", KEY));
    expect(byOid(rows, UPN_OID)).toMatchObject({
      exact: true,
      signal: "upn",
    });
    expect(byOid(rows, GUEST_OID)).toMatchObject({
      exact: false,
      signal: "guest-upn",
    });
    expect(byOid(rows, JANE_OID)).toMatchObject({
      exact: false,
      signal: "email",
    });
  });

  describe("with LiteLLM configured", () => {
    beforeEach(async () => {
      await seedLiteLLMConnection();
    });

    it("an identity linked to the LiteLLM user with the key's email is exact (litellm-link), and only it", async () => {
      const fake = installLiteLLM([{ id: LL_USER, email: KEY }]);
      await linkIdentityToLiteLLMUser(JANE_OID, LL_USER);
      await seedSignedIn(OTHER_OID, { email: KEY, upn: "other@company.com" });
      signInAs("admin");
      const rows = await items(await read("team-a", KEY));
      expect(byOid(rows, JANE_OID)).toMatchObject({
        exact: true,
        signal: "litellm-link",
      });
      expect(byOid(rows, OTHER_OID)).toMatchObject({
        exact: false,
        signal: "email",
      });
      expect(fake.calls.length).toBeGreaterThan(0);
      expect(fake.calls.every((c) => c.method === "GET")).toBe(true);
    });

    it("a LiteLLM user with the key's email that no identity holds makes nobody exact (T-IV2: the LiteLLM email alone never selects)", async () => {
      installLiteLLM([{ id: LL_USER, email: KEY }]);
      signInAs("teamAdminA");
      const rows = await items(await read("team-a", KEY));
      expect(rows.map((r) => r.oid)).toEqual([JANE_OID]);
      expect(rows[0]).toMatchObject({ exact: false, signal: "email" });
    });

    it("the link adds no candidate: an identity linked to that user but matching the key by nothing stays out, so a lead's set is never widened (T-IV1, T-IV2)", async () => {
      installLiteLLM([{ id: LL_USER, email: KEY }]);
      await seedSignedIn(OTHER_OID, {
        upn: "other@company.com",
        email: "other@company.com",
      });
      await linkIdentityToLiteLLMUser(OTHER_OID, LL_USER);
      for (const caller of ["teamAdminA", "admin"] as const) {
        signInAs(caller);
        const rows = await items(await read("team-a", KEY));
        expect(rows.map((r) => r.oid)).toEqual([JANE_OID]);
      }
    });

    it("a lead gets the boolean and the signal only: no LiteLLM user id, no LiteLLM email field, nothing beyond the six row fields (threat R1)", async () => {
      installLiteLLM([{ id: LL_USER, email: KEY }]);
      await linkIdentityToLiteLLMUser(JANE_OID, LL_USER);
      signInAs("teamAdminA");
      const res = await read("team-a", KEY);
      const text = await res.clone().text();
      expect(text).not.toContain(LL_USER);
      expect(text).not.toContain("litellmUserId");
      const rows = await items(res);
      expect(Object.keys(rows[0] ?? {}).sort()).toEqual(
        ["displayName", "email", "exact", "oid", "signal", "upn"].sort(),
      );
    });
  });

  it("with LiteLLM not configured the read still answers 200 with no litellm-link signal and no gateway call (LD37)", async () => {
    const fake = installLiteLLM([{ id: LL_USER, email: KEY }]);
    await linkIdentityToLiteLLMUser(JANE_OID, LL_USER);
    signInAs("teamAdminA");
    const rows = await items(await read("team-a", KEY));
    expect(rows).toEqual([
      expect.objectContaining({ oid: JANE_OID, exact: false, signal: "email" }),
    ]);
    expect(fake.calls).toEqual([]);
  });
});
