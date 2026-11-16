import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { OID_A, OID_B } from "@/test/support/access-test-support";
import { resetDeniedAudit } from "@/lib/data/access/audit";
import { csvRecords, parseCsv } from "@/test/support/csv-test-support";
import {
  auditToday,
  deniedToday,
  expectError,
  invoke,
  signInAs,
} from "@/test/support/governance-route-support";
import {
  clearTable,
  ensureTestTable,
  putRaw,
} from "@/test/support/test-support";

import { GET } from "../access-review/route";

// Source: docs/specs/2026-11-10-access-control.md - "Access review" (CSV of
// every identity: global roles and sources, member team and admin scopes with
// sources, lastSignInAt, aliases, the LiteLLM link, flags; "The export is
// audited"), "API routes (additions)" (/api/access-review GET internal-admin
// or internal-auditor, audited), "Audit log" ("access-review exports are
// themselves audited"), "Enforcement" items 2, 4, 5 (exports are scoped; here
// admin/auditor only). Spec: Access Control "API routes (additions)".
// Decisions: columns are exactly HEADER below; composite cells join items with
// "; " as `role (source)`, `teamId (source)`, `type:id (source)`; the LiteLLM
// link column is present and empty (owned by the LiteLLM units); a cell
// starting with = + - @ tab or CR is prefixed with ' (CSV injection); exactly
// one accessreview.export record per successful export, none on 401/403.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});

const PATH = "/api/access-review";
const HEADER = [
  "oid",
  "email",
  "displayName",
  "authMethod",
  "globalRoles",
  "team",
  "adminScopes",
  "lastSignInAt",
  "aliases",
  "litellmLink",
  "flags",
];
const FIXED_NOW = new Date("2026-11-15T12:00:00.000Z");

const get = () => invoke(GET, { method: "GET", path: PATH });
const exportsToday = async () =>
  (await auditToday()).filter((r) => r.action === "accessreview.export");

async function seedIdentity(extra: Record<string, unknown>): Promise<void> {
  const oid = String(extra.oid);
  await putRaw({
    PK: `IDENT#${oid}`,
    SK: "META",
    gsi1pk: "IDENTS",
    gsi1sk: `IDENT#${oid}`,
    tid: "t",
    lastSignInAt: "2026-11-10T00:00:00.000Z",
    lastSeenRoles: ["internal-viewer"],
    authMethod: "entra",
    version: 1,
    ...extra,
  });
}

beforeAll(ensureTestTable);
beforeEach(async () => {
  await clearTable();
  resetDeniedAudit();
  signInAs("admin");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(FIXED_NOW);
});
afterEach(() => vi.useRealTimers());

describe("GET /api/access-review", () => {
  it.each(["viewer", "orgAdmin", "noRoles"] as const)(
    "403 FORBIDDEN for %s; no export record and no denied record",
    async (caller) => {
      await seedIdentity({ oid: OID_A, email: "ada@example.com" });
      signInAs(caller);
      await expectError(await get(), 403, "FORBIDDEN");
      expect(await auditToday()).toEqual([]);
      expect(await deniedToday()).toEqual([]);
    },
  );

  it.each(["admin", "auditor"] as const)(
    "%s downloads a CSV with the attachment headers",
    async (caller) => {
      signInAs(caller);
      const res = await get();
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
      expect(res.headers.get("content-disposition")).toBe(
        'attachment; filename="access-review-2026-11-15.csv"',
      );
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(parseCsv(await res.text())[0]).toEqual(HEADER);
    },
  );

  it("an empty table exports the header row only and is still audited once", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const rows = parseCsv(await res.text());
    expect(rows).toEqual([HEADER]);
    expect(await exportsToday()).toHaveLength(1);
  });

  it("writes exactly one accessreview.export record (category change, actor = the exporter) per export", async () => {
    await seedIdentity({ oid: OID_A, email: "ada@example.com" });
    await get();
    let records = await exportsToday();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action: "accessreview.export",
      category: "change",
      result: "success",
      actor: "oid-admin",
    });
    expect(records[0]?.target).toBeDefined();
    signInAs("auditor");
    await get();
    records = await exportsToday();
    expect(records.map((r) => r.actor).sort()).toEqual([
      "oid-admin",
      "oid-auditor",
    ]);
  });

  it("exports one row per identity with roles, team, scopes, sign-in, aliases and flags; the LiteLLM link is empty", async () => {
    await seedIdentity({
      oid: OID_A,
      email: "ada@example.com",
      displayName: "Ada",
      lastSeenRoles: ["internal-auditor"],
      groupsOverage: true,
    });
    await putRaw({
      PK: `IDENT#${OID_A}`,
      SK: "AFFILIATION",
      gsi1pk: "MEMBERS#TEAM#team-a",
      gsi1sk: `IDENT#${OID_A}`,
      oid: OID_A,
      teamId: "team-a",
      source: "sso",
      version: 1,
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
      createdBy: "system",
    });
    await putRaw({
      PK: `IDENT#${OID_A}`,
      SK: "ADMINSCOPE#DEPT#dept-1",
      gsi1pk: "ADMINS#DEPT#dept-1",
      gsi1sk: `IDENT#${OID_A}`,
      oid: OID_A,
      scopeType: "department",
      scopeId: "dept-1",
      source: "ui",
      version: 1,
      createdAt: "2026-11-01T00:00:00.000Z",
      createdBy: "oid-admin",
    });
    await putRaw({
      PK: `IDENT#${OID_A}`,
      SK: "LINK",
      oid: OID_A,
      usageIdentities: ["ada@example.com"],
      aliases: ["ada.old@example.com"],
      litellmUserId: "lu-1",
      version: 1,
      updatedAt: "2026-11-01T00:00:00.000Z",
    });
    await seedIdentity({ oid: OID_B, email: "bob@example.com" });

    const text = await (await get()).text();
    const records = csvRecords(text);
    expect(records).toHaveLength(2);
    const ada = records.find((r) => r.oid === OID_A);
    expect(ada).toMatchObject({
      email: "ada@example.com",
      displayName: "Ada",
      authMethod: "entra",
      globalRoles: "internal-auditor (sso)",
      team: "team-a (sso)",
      adminScopes: "department:dept-1 (ui)",
      lastSignInAt: "2026-11-10T00:00:00.000Z",
      aliases: "ada.old@example.com",
      litellmLink: "",
      flags: "overage",
    });
    expect(records.find((r) => r.oid === OID_B)).toMatchObject({
      team: "",
      adminScopes: "",
      aliases: "",
      litellmLink: "",
      flags: "",
    });
  });

  it.each([
    ['=HYPERLINK("http://evil")', '\'=HYPERLINK("http://evil")'],
    ["+1+1", "'+1+1"],
    ["-2+3", "'-2+3"],
    ["@SUM(A1)", "'@SUM(A1)"],
    ["\tTabbed", "'\tTabbed"],
    ["\rCarriage", "'\rCarriage"],
    ["Plain Name", "Plain Name"],
    ["Mid=dle", "Mid=dle"],
  ])(
    "neutralises CSV injection in a display name %j",
    async (name, expected) => {
      await seedIdentity({
        oid: OID_A,
        email: "ada@example.com",
        displayName: name,
      });
      const [row] = csvRecords(await (await get()).text());
      expect(row?.displayName).toBe(expected);
    },
  );

  it("neutralises injection in every text column, not just the name (email, alias)", async () => {
    await seedIdentity({ oid: OID_A, email: "=cmd|' /C calc'!A0" });
    await putRaw({
      PK: `IDENT#${OID_A}`,
      SK: "LINK",
      oid: OID_A,
      usageIdentities: [],
      aliases: ["@alias"],
      version: 1,
      updatedAt: "2026-11-01T00:00:00.000Z",
    });
    const [row] = csvRecords(await (await get()).text());
    expect(row?.email?.startsWith("'=")).toBe(true);
    expect(row?.aliases?.startsWith("'@")).toBe(true);
  });

  it("quotes commas, double quotes and newlines so a cell cannot add columns or rows", async () => {
    await seedIdentity({
      oid: OID_A,
      email: "ada@example.com",
      displayName: 'Lovelace, "Ada"\nCountess',
    });
    await seedIdentity({ oid: OID_B, email: "bob@example.com" });
    const parsed = parseCsv(await (await get()).text());
    expect(parsed).toHaveLength(3);
    expect(parsed.every((r) => r.length === HEADER.length)).toBe(true);
    const ada = csvRecords(await (await get()).text()).find(
      (r) => r.oid === OID_A,
    );
    expect(ada?.displayName).toBe('Lovelace, "Ada"\nCountess');
  });

  it("never exports lockout state or secrets", async () => {
    await seedIdentity({
      oid: OID_A,
      email: "ada@example.com",
      failedAttempts: 3,
      lockedUntil: "2026-12-31T00:00:00.000Z",
      passwordHash: "argon-secret",
    });
    const text = await (await get()).text();
    expect(text).not.toContain("argon-secret");
    expect(text).not.toContain("2026-12-31");
  });
});
