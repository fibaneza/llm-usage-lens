import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { BedrockGatewayViewSchema } from "@llm-usage-lens/shared";
import { describe, expect, it, vi } from "vitest";

import {
  BASE_URL,
  HOST,
  call,
  expectError,
  setupViewsSuite,
  signInWithRoles,
  stubLiteLLMEnv,
} from "@/test/fakes/fake-litellm-views";
import { signInAs } from "@/test/fixtures/scope-fixtures";
import type { CallerName } from "@/test/fixtures/scope-fixtures";
import { AUDIT_DAY, send } from "@/test/support/litellm-member-writes-support";
import { storeGateway } from "@/test/support/litellm-combined-support";
import { TEST_TABLE_NAME, testDoc } from "@/test/support/test-support";

// Source: docs/specs/2026-11-10-litellm.md - "Combined usage and My usage (L6)
// -> Gateway configuration, Route" (GET Admin, org-admin (LD24), Auditor; PUT
// Admin only, 403 and one `denied` record for anyone else (LT30); PUT body
// { version: number | null, principals, accountIds }; a stale version -> 409
// CONFLICT; each successful write appends one audit record
// litellm.gateway.update; no stored item -> 200 { gatewayConfigured: false,
// version: 0, principals: [], accountIds: [] }; Validation: 400 with no audit
// record, every account id must exist in AccountMeta), "API routes", LT29,
// LT30, LT33; Access Control D17; Rule 10.3 (403 before parsing; Cache-Control
// private, no-store). 401, Origin and the cross-cutting shape are the
// route-contract suite's (Rule 60.23).
//
// Contract for the developer (app/api/litellm/gateway/route.ts, force-dynamic):
//   GET -> data = BedrockGatewayViewSchema: { gatewayConfigured, version,
//     principals, accountIds, updatedAt?, updatedBy? }; gatewayConfigured is
//     "at least one principal or account id".
//   PUT -> 200 with the same data; withRoute(..., { requireAdmin: true,
//     denied: { action: "litellm.gateway.update", pattern: "/api/litellm/gateway" } }).
//     400 BAD_REQUEST for an invalid body and for an unknown account id
//     (data module NOT_FOUND), 409 CONFLICT for a stale version.
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.passThroughNextCache;
});

const state = setupViewsSuite();

const PATH = "/api/litellm/gateway";
type Who = CallerName | "noRole";
const as = async (who: Who) => {
  if (who === "noRole") await signInWithRoles([]);
  else signInAs(who);
};

async function handlers() {
  stubLiteLLMEnv();
  return import("./route");
}
const get = async () => call((await handlers()).GET, PATH);
const put = async (body: unknown) =>
  send((await handlers()).PUT, {
    method: "PUT",
    path: PATH,
    params: {},
    body,
  });

const ROLE = { type: "iam-role", value: "litellm-bedrock" };
const VALID = {
  version: null,
  principals: [ROLE],
  accountIds: ["000000000002"],
};

async function stored() {
  const res = await testDoc().send(
    new GetCommand({
      TableName: TEST_TABLE_NAME,
      Key: { PK: "LITELLM#CONFIG", SK: "GATEWAY" },
    }),
  );
  return res.Item as Record<string, unknown> | undefined;
}
async function records() {
  const { listAuditRecords } = await import("@/lib/data/access/audit");
  return (await listAuditRecords(AUDIT_DAY)).filter(
    (r) => r.action === "litellm.gateway.update",
  );
}

describe("GET /api/litellm/gateway", () => {
  // Complete role matrix (security, Rule 60.24a): LD24 adds org-admin to the reads.
  it.each<[Who, 200 | 403]>([
    ["admin", 200],
    ["orgAdmin", 200],
    ["auditor", 200],
    ["teamAdminA", 403],
    ["deptAdminEng", 403],
    ["memberA", 403],
    ["viewerNone", 403],
    ["noRole", 403],
  ])("%s -> %i, no-store, no LiteLLM call", async (who, status) => {
    await as(who);
    const { res } = await get();
    expect(res.status).toBe(status);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    if (status === 403) await expectError(res, 403, "FORBIDDEN");
    expect(state.fake.calls).toHaveLength(0);
  });

  it("no stored item answers 200 gatewayConfigured false, version 0, empty lists (a handled state)", async () => {
    await as("admin");
    const { body } = await get();
    expect(body.data).toEqual({
      gatewayConfigured: false,
      version: 0,
      principals: [],
      accountIds: [],
    });
  });

  it("returns the stored lists, version and who/when, gatewayConfigured true", async () => {
    await storeGateway({
      principals: [ROLE as never],
      accountIds: ["000000000002"],
      version: 3,
    });
    await as("auditor");
    const { body } = await get();
    const data = BedrockGatewayViewSchema.parse(body.data);
    expect(data).toMatchObject({
      gatewayConfigured: true,
      version: 3,
      principals: [ROLE],
      accountIds: ["000000000002"],
    });
  });

  it("a stored item with both lists cleared is not configured", async () => {
    await storeGateway({ version: 2 });
    await as("admin");
    const { body } = await get();
    expect(body.data).toMatchObject({ gatewayConfigured: false, version: 2 });
  });
});

describe("PUT /api/litellm/gateway", () => {
  // LT30 + D17: complete for the refused roles (security).
  it.each<Who>([
    "orgAdmin",
    "auditor",
    "teamAdminA",
    "deptAdminEng",
    "memberA",
    "viewerNone",
    "noRole",
  ])(
    "%s: 403 FORBIDDEN before the body is parsed, stores nothing, writes one denied record (LT30)",
    async (who) => {
      await as(who);
      const { PUT } = await handlers();
      const res = await PUT(
        new Request(`${BASE_URL}${PATH}`, {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            host: HOST,
            origin: BASE_URL,
          },
          body: "not json",
        }),
        { params: Promise.resolve({}) },
      );
      await expectError(res, 403, "FORBIDDEN");
      expect(await stored()).toBeUndefined();
      const denied = await records();
      expect(denied).toHaveLength(1);
      expect(denied[0]).toMatchObject({
        action: "litellm.gateway.update",
        result: "denied",
        code: "FORBIDDEN",
        route: { method: "PUT", pattern: PATH },
      });
      expect(state.fake.calls).toHaveLength(0);
    },
  );

  it("Admin creates the configuration: 200 view, stored item, exactly one success record, no LiteLLM call", async () => {
    await as("admin");
    const { res, body } = await put(VALID);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(BedrockGatewayViewSchema.parse(body.data)).toMatchObject({
      gatewayConfigured: true,
      version: 1,
      principals: [ROLE],
      accountIds: ["000000000002"],
    });
    expect(await stored()).toMatchObject({ version: 1, principals: [ROLE] });
    const written = await records();
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      result: "success",
      target: { type: "litellm-gateway", id: "default" },
    });
    expect(state.fake.calls).toHaveLength(0);
  });

  it("a later read sees the write at once (LT33: read per request, never cached)", async () => {
    await as("admin");
    await put(VALID);
    const { body } = await get();
    expect(body.data).toMatchObject({ gatewayConfigured: true, version: 1 });
    await put({ ...VALID, version: 1, principals: [], accountIds: [] });
    const cleared = await get();
    expect(cleared.body.data).toMatchObject({
      gatewayConfigured: false,
      version: 2,
    });
  });

  it("a stale version is 409 CONFLICT: stored item unchanged, no audit record", async () => {
    await storeGateway({ principals: [ROLE as never], version: 2 });
    await as("admin");
    const { res } = await put({ ...VALID, version: 1 });
    await expectError(res, 409, "CONFLICT");
    expect(await stored()).toMatchObject({ version: 2 });
    expect(await records()).toHaveLength(0);
  });

  // Validation: 400, no audit record, nothing stored (spec). Representative:
  // the schema's own table is in packages/shared.
  it.each([
    [
      "a person key as a usage-key (LT29)",
      { principals: [{ type: "usage-key", value: "alice@example.com" }] },
    ],
    [
      "a person key as an iam-role (LT29)",
      { principals: [{ type: "iam-role", value: "alice@example.com" }] },
    ],
    [
      "an invalid role name",
      { principals: [{ type: "iam-role", value: "bad name" }] },
    ],
    [
      "a duplicate after normalisation",
      { principals: [ROLE, { type: "iam-role", value: "LITELLM-BEDROCK" }] },
    ],
    ["a malformed account id", { accountIds: ["123"] }],
    ["an account id with no AccountMeta", { accountIds: ["999999999999"] }],
    ["version 0", { version: 0 }],
    ["an unknown field", { extra: true }],
  ])(
    "%s: 400 BAD_REQUEST, nothing stored, no audit record",
    async (_n, patch) => {
      await as("admin");
      const { res } = await put({ ...VALID, ...patch });
      await expectError(res, 400, "BAD_REQUEST");
      expect(await stored()).toBeUndefined();
      expect(await records()).toHaveLength(0);
    },
  );

  it("both lists empty is accepted (clear) and recorded", async () => {
    await as("admin");
    const { res, body } = await put({
      ...VALID,
      principals: [],
      accountIds: [],
    });
    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({ gatewayConfigured: false, version: 1 });
    expect(await records()).toHaveLength(1);
  });
});
