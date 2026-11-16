import {
  AccountMetaSchema,
  ApiErrorBodySchema,
  ApiErrorCodeSchema,
} from "@llm-usage-lens/shared";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/auth";
import { getAccountMeta } from "@/lib/data/account-meta";
import {
  clearTable,
  ensureTestTable,
  loadFixtures,
  makeAccount,
} from "@/test/support/test-support";

import { DELETE, PATCH } from "./[id]/route";
import { POST } from "./route";

const acct = (n: number) => String(n).padStart(12, "0");

// Source: docs/specs/2026-05-15-data-model.md — "API Routes" (Settings CRUD;
// HTTP status codes: 401 no session, 403 signed in without the Admin role on an
// account write route); docs/specs/2026-05-15-system-architecture.md —
// "Authentication & Access" → "Account-mutation role" (a signed-in user without
// Admin gets 403 FORBIDDEN from a write route after the session check and
// before input parsing or any DynamoDB call, so never 400/404);
// contract-3.3 U3; Rules 10.3, 50.4, 60.23. Only `@/auth` is mocked.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});

const existing = makeAccount(1);
const body = {
  accountId: acct(42),
  accountName: "new-account",
  departmentId: "dept-finance",
  departmentName: "Finance",
  teamId: "team-ledger",
  teamName: "Ledger",
  region: "ap-southeast-2",
};

function setSession(session: unknown) {
  (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(session);
}

const adminSession = (roles: string[] = ["internal-admin"]) => ({
  user: { oid: "oid-test", name: "Test", email: "t@company.com", roles },
});

// `signedIn(true)` is an Admin: the existing success paths below need the role.
function signedIn(on: boolean) {
  setSession(on ? adminSession() : null);
}

async function expectForbidden(res: Response) {
  expect(res.status).toBe(403);
  const raw = await res.json();
  const parsed = ApiErrorBodySchema.parse(raw);
  expect(ApiErrorCodeSchema.parse(parsed.error.code)).toBe("FORBIDDEN");
  expect(raw.data).toBeUndefined();
}

// Writes are same-origin (Access Control spec — Enforcement item 6): Origin's
// host equals the Host header. A Node `Request` has no Host header, so it is
// set explicitly.
const HOST = "localhost:3000";
const SAME_ORIGIN = `http://${HOST}`;
const URL_ = `http://${HOST}/api/accounts`;
const sameOriginHeaders = { host: HOST, origin: SAME_ORIGIN };

const json = (
  method: string,
  payload: unknown,
  headers: Record<string, string> = sameOriginHeaders,
) =>
  new Request(URL_, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });

const deleteRequest = (headers: Record<string, string> = sameOriginHeaders) =>
  new Request(URL_, { method: "DELETE", headers });

const withId = (id: string) => ({ params: Promise.resolve({ id }) });

beforeAll(ensureTestTable);
beforeEach(async () => {
  signedIn(true);
  await clearTable();
  await loadFixtures({ accounts: [existing] });
});

describe("POST /api/accounts", () => {
  it("400 for an invalid body", async () => {
    const res = await POST(json("POST", { ...body, accountId: "123" }));
    expect(res.status).toBe(400);
    expect(ApiErrorBodySchema.parse(await res.json()).error.code).toBe(
      "BAD_REQUEST",
    );
  });

  it("400 for a region other than ap-southeast-2 and writes nothing", async () => {
    for (const region of ["us-east-1", ""]) {
      const res = await POST(json("POST", { ...body, region }));
      expect(res.status).toBe(400);
      expect(ApiErrorBodySchema.parse(await res.json()).error.code).toBe(
        "BAD_REQUEST",
      );
    }
    expect(await getAccountMeta(body.accountId)).toBeNull();
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
  const del = (id = existing.accountId) => DELETE(deleteRequest(), withId(id));

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

describe("account write routes require the Admin role", () => {
  // 403 precedes every DynamoDB call: had the handler touched the table first,
  // these would surface as 400 (already exists) / 404 (missing) instead.

  // Data Model spec — HTTP status codes: the role is "checked after the session
  // and before input parsing, so a non-admin gets 403, never 400/404". Every
  // request below would be a 400 for an Admin.

  // The session check still runs first: no session is 401 even when the body
  // or id would also be rejected.

  describe("an Admin among several roles can still write", () => {
    beforeEach(() =>
      setSession(adminSession(["internal-viewer", "internal-admin"])),
    );

    it("POST creates the account", async () => {
      const res = await POST(json("POST", body));
      expect(res.status).toBe(200);
      expect(await getAccountMeta(body.accountId)).toMatchObject({
        accountId: body.accountId,
        active: true,
      });
    });

    it("PATCH updates the account", async () => {
      const res = await PATCH(
        json("PATCH", { accountName: "renamed-by-admin" }),
        withId(existing.accountId),
      );
      expect(res.status).toBe(200);
      expect((await getAccountMeta(existing.accountId))?.accountName).toBe(
        "renamed-by-admin",
      );
    });

    it("DELETE deactivates the account", async () => {
      const res = await DELETE(deleteRequest(), withId(existing.accountId));
      expect(res.status).toBe(200);
      expect((await getAccountMeta(existing.accountId))?.active).toBe(false);
    });
  });
});

// Access Control spec — Enforcement item 6: an admin write with a missing or
// foreign Origin is 403 FORBIDDEN, writes nothing, and does not reveal whether
// the body or id is valid.
describe("account writes are same-origin only", () => {
  it("a same-origin POST that is not application/json is 400 BAD_REQUEST", async () => {
    const res = await POST(
      json("POST", JSON.stringify(body), {
        ...sameOriginHeaders,
        "content-type": "text/plain",
      }),
    );
    expect(res.status).toBe(400);
    expect(ApiErrorBodySchema.parse(await res.json()).error.code).toBe(
      "BAD_REQUEST",
    );
    expect(await getAccountMeta(body.accountId)).toBeNull();
  });

  it("falls back to the request URL host when the Host header is absent", async () => {
    const same = new Request(URL_, {
      method: "POST",
      headers: { "content-type": "application/json", origin: SAME_ORIGIN },
      body: JSON.stringify(body),
    });
    expect((await POST(same)).status).toBe(200);
    const cross = new Request(URL_, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example.test",
      },
      body: JSON.stringify({ accountName: "x" }),
    });
    await expectForbidden(await PATCH(cross, withId(existing.accountId)));
  });

  it("the 403 message names the internal-admin role", async () => {
    setSession({
      user: { oid: "oid-test", name: "M", roles: ["internal-viewer"] },
    });
    const res = await POST(json("POST", body));
    expect((await res.json()).error.message).toBe(
      "internal-admin role required",
    );
  });
});
