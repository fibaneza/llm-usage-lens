import { describe, expect, it } from "vitest";

import {
  ConnectionTestResultSchema,
  LITELLM_OPERATION_NAMES,
  LiteLLMGatewayConfigSchema,
} from "../index";

// Source: docs/specs/2026-11-10-litellm.md — "Guardrail configuration"
// (LD19, amended 2026-11-15: the config file holds only per-operation
// `enabled: false` defaults, keyed by allowlisted operation name; `true`, an
// unknown operation, an unknown field (including `wildcardWarning`, which is
// code-only) or an invalid value fails startup; nothing configurable can name
// a route or body field or widen), "Allowlist (the
// gateway)" (operation names), implementation-phases L2 Verify ("the config
// schema rejects an unknown operation, route or field and a widening value");
// Rule 60.19. The checked-in file moved to config/config.yaml (unit CFG, A8);
// its conversion test lives in apps/dashboard/lib/config/app-config.test.ts.
const parse = (v: unknown) => LiteLLMGatewayConfigSchema.safeParse(v);
const ok = {
  operations: { resetMemberSpend: { enabled: false } },
};

describe("LITELLM_OPERATION_NAMES", () => {
  it("lists every read and write operation of the allowlist table, and no other", () => {
    expect([...LITELLM_OPERATION_NAMES].sort()).toEqual(
      [
        "getTeam",
        "listProxyTeams",
        "getTeamDailySpend",
        "getUser",
        "findUserByEmail",
        "searchUsers",
        "getUserDailySpend",
        "listKeys",
        "getKey",
        "listSpendLogs",
        "listProxyModels",
        "listProxyAuditLog",
        "getGlobalSpendReport",
        "createTeam",
        "setTeamBudget",
        "setTeamLimits",
        "setTeamModels",
        "addTeamMember",
        "createUser",
        "removeTeamMember",
        "setMemberBudget",
        "setMemberLimits",
        "resetMemberSpend",
        // RS2 (LiteLLM spec - Writes, D-RS1): POST /user/update { user_id, spend: 0 }.
        "resetUserSpend",
        "resetMemberBudget",
        "disableMember",
        "enableMember",
        "generateMemberKey",
        "updateMemberKey",
        "blockKey",
        "unblockKey",
        "deleteKey",
        "rotateKey",
        // M4 (LiteLLM spec - MG-D11a): the route-less dashboard operation.
        "requestBudgetReset",
      ].sort(),
    );
  });
});

describe("LiteLLMGatewayConfigSchema", () => {
  it("accepts per-operation enabled:false defaults", () => {
    expect(parse(ok).success).toBe(true);
  });

  it("rejects a wildcardWarning field as unknown (the warning is code-only)", () => {
    expect(parse({ ...ok, wildcardWarning: true }).success).toBe(false);
    expect(parse({ ...ok, wildcardWarning: false }).success).toBe(false);
  });

  it.each([
    "createTeam",
    "resetMemberSpend",
    "resetUserSpend",
    "deleteKey",
    "getTeam",
  ])(
    "rejects enabled:true for %s: the file can only switch an operation off",
    (op) => {
      expect(parse({ operations: { [op]: { enabled: true } } }).success).toBe(
        false,
      );
    },
  );

  it("accepts an empty operations map (the spec defaults then apply)", () => {
    expect(parse({ operations: {} }).success).toBe(true);
  });

  it("accepts a read operation (reads gain a toggle, LD19)", () => {
    expect(
      parse({ ...ok, operations: { getTeam: { enabled: false } } }).success,
    ).toBe(true);
  });

  it.each([
    ["an unknown operation", { deleteTeam: { enabled: false } }],
    [
      "a route used as an operation key",
      { "/team/delete": { enabled: false } },
    ],
    ["an operation name in the wrong case", { getteam: { enabled: false } }],
  ])("rejects %s", (_n, operations) => {
    expect(parse({ ...ok, operations }).success).toBe(false);
  });

  it.each([
    ["a route", { enabled: false, route: "/team/delete" }],
    ["a routes list", { enabled: false, routes: ["/team/delete"] }],
    ["allowedRoutes", { enabled: false, allowedRoutes: ["/*"] }],
    ["a method", { enabled: false, method: "DELETE" }],
    ["a body field", { enabled: false, bodyFields: ["allowed_routes"] }],
    ["a body", { enabled: false, body: { user_role: "proxy_admin" } }],
  ])("rejects an operation entry carrying %s", (_n, entry) => {
    expect(parse({ ...ok, operations: { createTeam: entry } }).success).toBe(
      false,
    );
  });

  it.each([
    ["routes", { routes: ["/team/delete"] }],
    ["allowedRoutes", { allowedRoutes: ["/*"] }],
    ["denylist", { denylist: [] }],
    ["edition", { edition: "enterprise" }],
    ["bodyFields", { bodyFields: ["key"] }],
    ["an unknown field", { somethingElse: 1 }],
  ])("rejects a top-level %s", (_n, extra) => {
    expect(parse({ ...ok, ...extra }).success).toBe(false);
  });

  it.each([
    ["a string wildcard", "*"],
    ["the string 'all'", "all"],
    ["the string 'true'", "true"],
    ["a number", 1],
    ["null", null],
    ["a list of routes", ["/team/delete"]],
    ["an object", { allow: "*" }],
  ])("rejects %s as an `enabled` value (a widening value)", (_n, enabled) => {
    expect(
      parse({ ...ok, operations: { deleteKey: { enabled } } }).success,
    ).toBe(false);
  });

  it("rejects a non-object document", () => {
    expect(parse(null).success).toBe(false);
    expect(parse([]).success).toBe(false);
  });
});

describe("ConnectionTestResultSchema — warnings (Gateway guardrails item 6)", () => {
  it("accepts a warnings list and defaults it to empty when absent", () => {
    const withWarnings = ConnectionTestResultSchema.safeParse({
      result: "ok",
      message: "m",
      warnings: ["service key uses temporary wildcards (`/team/*`, `/key/*`)"],
    });
    expect(withWarnings.success).toBe(true);
    const without = ConnectionTestResultSchema.parse({
      result: "ok",
      message: "m",
    });
    expect(without.warnings).toEqual([]);
  });

  it("rejects non-string warnings", () => {
    expect(
      ConnectionTestResultSchema.safeParse({
        result: "ok",
        message: "m",
        warnings: [1],
      }).success,
    ).toBe(false);
  });
});
