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
  createAccount,
  deactivateAccount,
  getAccountMeta,
  getAccountsByDepartment,
  updateAccount,
} from "@/lib/data/account-meta";

import {
  clearTable,
  ensureTestTable,
  loadFixtures,
  makeAccount,
} from "@/test/test-support";

const acct = (n: number) => String(n).padStart(12, "0");

// Source: docs/specs/2026-05-15-data-model.md — "Entity: AccountMeta"
// (GSI1 keyed by department), "API Routes" (Settings CRUD), Rule 60.17.
const NOW = new Date("2026-10-29T10:00:00.000Z");
const existing = makeAccount(1);
const input = {
  accountId: acct(42),
  accountName: "new-account",
  departmentId: "dept-finance",
  departmentName: "Finance",
  teamId: "team-ledger",
  teamName: "Ledger",
  region: "us-east-1",
};

beforeAll(ensureTestTable);
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  await clearTable();
  await loadFixtures({ accounts: [existing] });
});
afterEach(() => vi.useRealTimers());

describe("createAccount", () => {
  it("stores an active account with createdAt/updatedAt and indexes it by department", async () => {
    const created = await createAccount(input);
    expect(created).toEqual({
      ...input,
      active: true,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
    expect(await getAccountMeta(input.accountId)).toEqual(created);
    const byDept = await getAccountsByDepartment("dept-finance");
    expect(byDept.map((a) => a.accountId)).toEqual([input.accountId]);
  });

  it("rejects when the account already exists and leaves it unchanged", async () => {
    await expect(
      createAccount({ ...input, accountId: existing.accountId }),
    ).rejects.toThrow();
    expect(await getAccountMeta(existing.accountId)).toEqual(existing);
  });
});

describe("updateAccount", () => {
  it("applies a partial patch, bumps updatedAt, keeps createdAt", async () => {
    const updated = await updateAccount(existing.accountId, {
      accountName: "renamed",
    });
    expect(updated).toEqual({
      ...existing,
      accountName: "renamed",
      updatedAt: NOW.toISOString(),
    });
    expect(await getAccountMeta(existing.accountId)).toEqual(updated);
  });

  it("moves the account in the department index when departmentId changes", async () => {
    await updateAccount(existing.accountId, {
      departmentId: "dept-finance",
      departmentName: "Finance",
    });
    expect(await getAccountsByDepartment("dept-engineering")).toEqual([]);
    const moved = await getAccountsByDepartment("dept-finance");
    expect(moved.map((a) => a.accountId)).toEqual([existing.accountId]);
  });

  it("returns null and creates nothing for a missing account", async () => {
    expect(
      await updateAccount("999999999999", { accountName: "x" }),
    ).toBeNull();
    expect(await getAccountMeta("999999999999")).toBeNull();
  });
});

describe("deactivateAccount", () => {
  it("soft-deletes: active false, item retained", async () => {
    const result = await deactivateAccount(existing.accountId);
    expect(result).toMatchObject({
      accountId: existing.accountId,
      active: false,
    });
    expect(await getAccountMeta(existing.accountId)).toMatchObject({
      active: false,
      accountName: existing.accountName,
    });
  });

  it("returns null for a missing account", async () => {
    expect(await deactivateAccount("999999999999")).toBeNull();
  });
});
