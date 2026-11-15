import { AccountListSchema, apiResponseSchema } from "@llm-usage-lens/shared";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => auth() }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/next-cache-fake");
  return mod.passThroughNextCache;
});

import { GET, revalidate } from "@/app/api/accounts/route";

import {
  clearTable,
  ensureTestTable,
  loadFixtures,
  makeAccount,
} from "@/test/test-support";

// Source: docs/specs/2026-05-15-data-model.md — "API Routes" (GET
// /api/accounts) + "Entity: AccountMeta"; Rule 10.3, Rule 50.4, Rule 60.23.
const call = () =>
  GET(new Request("http://localhost/api/accounts"), {
    params: Promise.resolve({}),
  });

beforeAll(ensureTestTable);
beforeEach(async () => {
  await clearTable();
  auth.mockReset();
});

describe("GET /api/accounts", () => {
  it("exports revalidate = 3600", () => {
    expect(revalidate).toBe(3600);
  });

  it("returns { data: [] } when there are no accounts", async () => {
    auth.mockResolvedValue({ user: { oid: "oid-test" } });
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [] });
  });

  // Reads are scoped (Access Control spec - Enforcement): a signed-in caller
  // with no recognised role or affiliation is a viewer with an empty scope.
  it.each([
    ["no roles claim", { user: { oid: "oid-test", name: "M" } }],
    [
      "an empty roles list",
      { user: { oid: "oid-test", name: "M", roles: [] } },
    ],
    [
      "other roles only",
      { user: { oid: "oid-test", name: "M", roles: ["Reader"] } },
    ],
  ])(
    "returns 200 with an empty list for a signed-in caller with %s and no affiliation",
    async (_n, session) => {
      auth.mockResolvedValue(session);
      const a = makeAccount(1);
      await loadFixtures({ accounts: [a] });
      const res = await call();
      expect(res.status).toBe(200);
      const body = apiResponseSchema(AccountListSchema).parse(await res.json());
      if (!("data" in body)) throw new Error("expected data");
      expect(body.data).toEqual([]);
    },
  );

  it("returns every account as { data: AccountMeta[] } validated by the response schema", async () => {
    auth.mockResolvedValue({
      user: { oid: "oid-test", roles: ["internal-admin"] },
    });
    const a = makeAccount(1);
    const b = makeAccount(2, { active: false });
    await loadFixtures({ accounts: [a, b] });
    const res = await call();
    expect(res.status).toBe(200);
    const body = apiResponseSchema(AccountListSchema).parse(await res.json());
    if (!("data" in body)) throw new Error("expected data");
    expect(body.data).toHaveLength(2);
    expect(body.data.map((x) => x.accountId).sort()).toEqual(
      [a.accountId, b.accountId].sort(),
    );
  });
});
