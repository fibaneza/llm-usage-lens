import { AccountListSchema, apiResponseSchema } from "@bedrock-usage/shared";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => auth() }));

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

  it("returns 401 without a session and exposes no accounts", async () => {
    auth.mockResolvedValue(null);
    await loadFixtures({ accounts: [makeAccount(1)] });
    const res = await call();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(body.data).toBeUndefined();
  });

  it("returns { data: [] } when there are no accounts", async () => {
    auth.mockResolvedValue({ user: {} });
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [] });
  });

  it("returns every account as { data: AccountMeta[] } validated by the response schema", async () => {
    auth.mockResolvedValue({ user: {} });
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
