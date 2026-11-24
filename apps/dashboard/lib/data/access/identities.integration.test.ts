import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  clearTable,
  ensureTestTable,
  putRaw,
} from "@/test/support/test-support";

import { listDirectory } from "./directory-rows";
import { listIdentitiesBounded, searchIdentities } from "./identities";

// Source: unit ST1 D-ST2 (docs/plans/20261118_teams_users_and_litellm_sync.md
// section 3; Access Control spec - API routes, `GET /api/identities/directory`
// `q`): a case-insensitive substring of display name, email or UPN across every
// page, at most 10 rows (server cap, whatever limit is passed), never a Scan.
// Rule 20.6: the GSI1 query pages on LastEvaluatedKey until `limit` or the end.
// Rows are the directory list's IdentityListItem shape; the function returns
// the rows array directly.
const TID = "00000000-0000-4000-8000-0000000000ff";
const oidN = (n: number) =>
  `00000000-0000-4000-8000-0000000004${String(n).padStart(3, "0")}`;

async function seed(
  n: number,
  over: { email?: string; upn?: string; name?: string } = {},
) {
  const oid = oidN(n);
  await putRaw({
    PK: `IDENT#${oid}`,
    SK: "META",
    gsi1pk: "IDENTS",
    gsi1sk: `IDENT#${oid}`,
    oid,
    tid: TID,
    email: over.email ?? `plain${n}@company.com`,
    ...(over.upn ? { upn: over.upn } : {}),
    displayName: over.name ?? `Plain ${n}`,
    lastSignInAt: "2026-01-01T00:00:00.000Z",
    lastSeenRoles: ["internal-viewer"],
    authMethod: "entra",
    version: 1,
  });
  return oid;
}
const oids = (rows: { oid: string }[]) => rows.map((r) => r.oid).sort();

beforeAll(ensureTestTable);
beforeEach(clearTable);

describe("searchIdentities (D-ST2)", () => {
  it("matches the display name", async () => {
    const hit = await seed(1, { name: "Zebulon Quartz" });
    await seed(2);
    expect(oids(await searchIdentities("quartz", 10))).toEqual([hit]);
  });

  it("matches the email", async () => {
    const hit = await seed(1, { email: "uniq.mail.token@company.com" });
    await seed(2);
    expect(oids(await searchIdentities("uniq.mail.token", 10))).toEqual([hit]);
  });

  it("matches the UPN even when name and email do not", async () => {
    const hit = await seed(1, { upn: "upn-only-token@tenant.onmicrosoft.com" });
    await seed(2);
    expect(oids(await searchIdentities("upn-only-token", 10))).toEqual([hit]);
  });

  it("is case-insensitive on the needle and on every field", async () => {
    const byName = await seed(1, { name: "MiXeD Name" });
    const byEmail = await seed(2, { email: "CaSe.Mail@Company.com" });
    const byUpn = await seed(3, { upn: "CaSe.Upn@Tenant.com" });
    expect(oids(await searchIdentities("MIXED NAME", 10))).toEqual([byName]);
    expect(oids(await searchIdentities("case.MAIL", 10))).toEqual([byEmail]);
    expect(oids(await searchIdentities("CASE.upn", 10))).toEqual([byUpn]);
  });

  it("returns the list row shape without lockout state, tenant or UPN", async () => {
    await seed(1, { name: "Shape Check", upn: "shape@tenant.com" });
    const [row] = await searchIdentities("shape check", 10);
    expect(row).toEqual({
      oid: oidN(1),
      email: "plain1@company.com",
      displayName: "Shape Check",
      authMethod: "entra",
      lastSignInAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("returns [] when nothing matches", async () => {
    await seed(1);
    expect(await searchIdentities("no-such-token", 10)).toEqual([]);
  });

  it("caps at 10 rows even when limit 50 is passed and more match", async () => {
    for (let i = 0; i < 15; i++) await seed(i, { name: `Capped ${i}` });
    expect(await searchIdentities("capped", 50)).toHaveLength(10);
  });

  it("honours a limit below the cap", async () => {
    for (let i = 0; i < 6; i++) await seed(i, { name: `Few ${i}` });
    expect(await searchIdentities("few", 3)).toHaveLength(3);
  });

  it("finds matches beyond the first GSI1 page (Rule 20.6)", async () => {
    // Fillers sort before the target and exceed one 100-item page.
    for (let i = 0; i < 130; i++) await seed(i);
    const hit = await seed(999, { name: "Far Away Needle" });
    expect(oids(await searchIdentities("far away needle", 10))).toEqual([hit]);
  });

  it("finds a UPN-only match beyond the first page", async () => {
    for (let i = 0; i < 130; i++) await seed(i);
    const hit = await seed(998, { upn: "deep-upn-token@tenant.com" });
    expect(oids(await searchIdentities("deep-upn-token", 10))).toEqual([hit]);
  });

  it("never returns items outside the identity list (pending invites, other partitions)", async () => {
    const hit = await seed(1, { name: "Visible Shared" });
    await putRaw({
      PK: "PENDING#shared@company.com",
      SK: "META",
      emailOrUpn: "shared@company.com",
      kind: "affiliation",
      teamId: "t1",
      displayName: "Visible Shared",
    });
    await putRaw({
      PK: "IDENT#00000000-0000-4000-8000-00000000dead",
      SK: "LINK",
      oid: "00000000-0000-4000-8000-00000000dead",
      email: "visible.shared@company.com",
      displayName: "Visible Shared",
    });
    expect(oids(await searchIdentities("visible shared", 10))).toEqual([hit]);
  });
});

// Source: Access Control spec - row `/api/identities/directory`, "From
// 2026-11-24 (unit US1, D-US3)": at most 2,000 identities are read and sorted;
// past the bound `truncated` is true and the order is partial (the first rows
// in GSI order). The bound is a parameter (default 2,000) so the rule is
// provable with a handful of rows.
describe("directory read bound (unit US1, D-US3: 2,000 bound, truncated)", () => {
  it("listIdentitiesBounded: a bound below the count returns exactly `bound` rows and truncated true", async () => {
    for (const n of [1, 2, 3, 4, 5]) await seed(n);
    const result = await listIdentitiesBounded({ bound: 3 });
    expect(result.truncated).toBe(true);
    expect(result.items).toHaveLength(3);
  });

  it.each([5, 6])(
    "listIdentitiesBounded: a bound of %i with 5 identities is not truncated",
    async (bound) => {
      for (const n of [1, 2, 3, 4, 5]) await seed(n);
      const result = await listIdentitiesBounded({ bound });
      expect(result.truncated).toBe(false);
      expect(result.items).toHaveLength(5);
    },
  );

  it("listIdentitiesBounded: the default bound leaves a small directory untruncated", async () => {
    await seed(1);
    expect((await listIdentitiesBounded()).truncated).toBe(false);
  });

  it("listDirectory passes the bound through: truncated true with a bound of 3, false with 10", async () => {
    for (const n of [1, 2, 3, 4, 5]) await seed(n);
    const base = {
      sort: "name" as const,
      dir: "asc" as const,
      cursorSecret: "test-secret",
      limit: 50,
      teamNames: new Map<string, string>(),
    };
    const small = await listDirectory({ ...base, bound: 3 });
    expect(small.ok && small.value.truncated).toBe(true);
    expect(small.ok && small.value.items).toHaveLength(3);
    const large = await listDirectory({ ...base, bound: 10 });
    expect(large.ok && large.value.truncated).toBe(false);
    expect(large.ok && large.value.items).toHaveLength(5);
  });
});
