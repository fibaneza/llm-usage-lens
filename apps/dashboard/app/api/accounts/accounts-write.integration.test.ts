import { AccountMetaSchema, ApiErrorBodySchema } from "@bedrock-usage/shared";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/auth";
import { getAccountMeta } from "@/lib/data/account-meta";
import {
  clearTable,
  ensureTestTable,
  loadFixtures,
  makeAccount,
} from "@/test/test-support";

import { DELETE, PATCH } from "./[id]/route";
import { POST } from "./route";

const acct = (n: number) => String(n).padStart(12, "0");

// Source: docs/specs/2026-05-15-data-model.md — "API Routes" (Settings CRUD);
// contract-3.3 U3; Rules 10.3, 50.4, 60.23. Only `@/auth` is mocked.
vi.mock("@/auth", () => ({ auth: vi.fn() }));

const existing = makeAccount(1);
const body = {
  accountId: acct(42),
  accountName: "new-account",
  departmentId: "dept-finance",
  departmentName: "Finance",
  teamId: "team-ledger",
  teamName: "Ledger",
  region: "us-east-1",
};

function signedIn(on: boolean) {
  (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
    on ? { user: { name: "Test", email: "t@company.com" } } : null,
  );
}

const json = (method: string, payload: unknown) =>
  new Request("http://localhost/api/accounts", {
    method,
    headers: { "content-type": "application/json" },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });

const withId = (id: string) => ({ params: Promise.resolve({ id }) });

beforeAll(ensureTestTable);
beforeEach(async () => {
  signedIn(true);
  await clearTable();
  await loadFixtures({ accounts: [existing] });
});

describe("POST /api/accounts", () => {
  it("401 without a session and writes nothing", async () => {
    signedIn(false);
    const res = await POST(json("POST", body));
    expect(res.status).toBe(401);
    expect(ApiErrorBodySchema.parse(await res.json()).error.code).toBe(
      "UNAUTHORIZED",
    );
    expect(await getAccountMeta(body.accountId)).toBeNull();
  });

  it("400 for an invalid body", async () => {
    const res = await POST(json("POST", { ...body, accountId: "123" }));
    expect(res.status).toBe(400);
    expect(ApiErrorBodySchema.parse(await res.json()).error.code).toBe(
      "BAD_REQUEST",
    );
  });

  it("400 for a body that is not JSON", async () => {
    const res = await POST(json("POST", "{not json"));
    expect(res.status).toBe(400);
  });

  it("400 BAD_REQUEST when the account already exists", async () => {
    const res = await POST(
      json("POST", { ...body, accountId: existing.accountId }),
    );
    expect(res.status).toBe(400);
    const parsed = ApiErrorBodySchema.parse(await res.json());
    expect(parsed.error.code).toBe("BAD_REQUEST");
    expect(parsed.error.message).toMatch(/already exists/i);
  });

  it("creates the account and returns it in { data }", async () => {
    const res = await POST(json("POST", body));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(AccountMetaSchema.parse(data)).toMatchObject({
      ...body,
      active: true,
    });
    expect(await getAccountMeta(body.accountId)).toEqual(data);
  });
});

describe("PATCH /api/accounts/[id]", () => {
  const patch = (payload: unknown, id = existing.accountId) =>
    PATCH(json("PATCH", payload), withId(id));

  it("401 without a session", async () => {
    signedIn(false);
    expect((await patch({ accountName: "x" })).status).toBe(401);
    expect((await getAccountMeta(existing.accountId))?.accountName).toBe(
      existing.accountName,
    );
  });

  it("400 for an invalid body", async () => {
    expect((await patch({ accountName: "" })).status).toBe(400);
  });

  it("404 NOT_FOUND for a missing account", async () => {
    const res = await patch({ accountName: "x" }, "999999999999");
    expect(res.status).toBe(404);
    expect(ApiErrorBodySchema.parse(await res.json()).error.code).toBe(
      "NOT_FOUND",
    );
  });

  it("applies a partial update and returns the account", async () => {
    const res = await patch({ accountName: "renamed" });
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(AccountMetaSchema.parse(data)).toMatchObject({
      accountId: existing.accountId,
      accountName: "renamed",
      departmentId: existing.departmentId,
    });
  });
});

describe("DELETE /api/accounts/[id]", () => {
  const del = (id = existing.accountId) =>
    DELETE(
      new Request("http://localhost/api/accounts", { method: "DELETE" }),
      withId(id),
    );

  it("401 without a session", async () => {
    signedIn(false);
    expect((await del()).status).toBe(401);
    expect((await getAccountMeta(existing.accountId))?.active).toBe(true);
  });

  it("404 NOT_FOUND for a missing account", async () => {
    const res = await del("999999999999");
    expect(res.status).toBe(404);
    expect(ApiErrorBodySchema.parse(await res.json()).error.code).toBe(
      "NOT_FOUND",
    );
  });

  it("soft-deletes: active false and the item remains", async () => {
    const res = await del();
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(AccountMetaSchema.parse(data).active).toBe(false);
    expect(await getAccountMeta(existing.accountId)).toMatchObject({
      active: false,
      accountName: existing.accountName,
    });
  });
});
