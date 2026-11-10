import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  getAccountMeta,
  getAccountsByDepartment,
  getAllAccounts,
} from "@/lib/data/account-meta";

import {
  clearTable,
  ensureTestTable,
  loadFixtures,
  makeAccount,
  makeRollup,
  putRaw,
} from "@/test/test-support";

// Source: docs/specs/2026-05-15-data-model.md — "Entity: AccountMeta" access
// patterns; Rule 20.6 (paginate), Rule 60.17 (no silent failures).
const eng1 = makeAccount(1);
const eng2 = makeAccount(2, { accountName: "account-2" });
const fin = makeAccount(3, {
  departmentId: "dept-finance",
  departmentName: "Finance",
  teamId: "team-ledger",
  teamName: "Ledger",
});

beforeAll(ensureTestTable);
beforeEach(async () => {
  await clearTable();
  await loadFixtures({ accounts: [eng1, eng2, fin] });
});

const byId = (a: { accountId: string }, b: { accountId: string }) =>
  a.accountId.localeCompare(b.accountId);

describe("getAccountMeta", () => {
  it("returns the parsed account without key attributes", async () => {
    const result = await getAccountMeta(eng1.accountId);
    expect(result).toEqual(eng1);
    expect(result).not.toHaveProperty("PK");
    expect(result).not.toHaveProperty("gsi1pk");
  });

  it("returns null for an unknown account", async () => {
    expect(await getAccountMeta("999999999999")).toBeNull();
  });

  it("rejects when the stored item fails the schema (no silent swallowing)", async () => {
    await putRaw({
      PK: "ACCT#000000000000",
      SK: "META",
      accountId: "000000000000",
      accountName: "",
    });
    await expect(getAccountMeta("000000000000")).rejects.toThrow();
  });
});

describe("getAllAccounts", () => {
  it("returns every AccountMeta and ignores other entities", async () => {
    await loadFixtures({ rollups: [makeRollup(eng1, "2026-10-20")] });
    const result = await getAllAccounts();
    expect([...result].sort(byId)).toEqual([eng1, eng2, fin]);
  });

  it("ignores identity items that share SK = META (regression: /api/accounts 500)", async () => {
    await putRaw({ PK: "IDENT#x", SK: "META" });
    await putRaw({
      PK: "IDENT#local:dev@localhost",
      SK: "META",
      gsi1pk: "IDENTS",
      gsi1sk: "IDENT#local:dev@localhost",
      oid: "local:dev@localhost",
      tid: "local",
      email: "dev@localhost",
      lastSignInAt: "2026-11-10T10:00:00.000Z",
      lastSeenRoles: ["internal-admin"],
      authMethod: "local",
      version: 1,
    });
    await putRaw({
      PK: "IDENT#master:master-admin",
      SK: "META",
      failedAttempts: 2,
    });
    const result = await getAllAccounts();
    expect([...result].sort(byId)).toEqual([eng1, eng2, fin]);
  });

  it("returns an empty array when there are no accounts", async () => {
    await clearTable();
    expect(await getAllAccounts()).toEqual([]);
  });

  it("paginates the scan past the 1MB page limit", async () => {
    // Bulky rollups push the scan past 1MB before all META items are read, so
    // a single Scan page cannot contain every account (Rule 20.6).
    const rollups = Array.from({ length: 35 }, (_, i) =>
      makeRollup(makeAccount(100 + i), "2026-10-20", { userCount: 450 }),
    );
    await loadFixtures({ rollups });
    const result = await getAllAccounts();
    expect([...result].sort(byId)).toEqual([eng1, eng2, fin]);
  });
});

describe("getAccountsByDepartment", () => {
  it("returns only accounts in that department", async () => {
    const result = await getAccountsByDepartment("dept-engineering");
    expect([...result].sort(byId)).toEqual([eng1, eng2]);

    expect(await getAccountsByDepartment("dept-finance")).toEqual([fin]);
  });

  it("returns [] for an unknown department", async () => {
    expect(await getAccountsByDepartment("dept-nope")).toEqual([]);
  });

  it("does not return rollups that share the table", async () => {
    await loadFixtures({ rollups: [makeRollup(eng1, "2026-10-20")] });
    const result = await getAccountsByDepartment("dept-engineering");
    expect(result).toHaveLength(2);
  });
});
