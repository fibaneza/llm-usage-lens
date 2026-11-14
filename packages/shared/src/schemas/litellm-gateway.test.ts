import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ConnectionTestResultSchema,
  LITELLM_OPERATION_NAMES,
  LiteLLMGatewayConfigSchema,
} from "../index";

// Source: docs/specs/2026-11-10-litellm.md — "Guardrail configuration"
// (LD19: the config file holds only per-operation `enabled` defaults and
// `wildcardWarning`, keyed by allowlisted operation name; an unknown
// operation, an unknown field or an invalid value fails startup; nothing
// configurable can name a route or body field or widen), "Allowlist (the
// gateway)" (operation names), implementation-phases L2 Verify ("the config
// schema rejects an unknown operation, route or field and a widening value");
// Rule 60.19.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const CONFIG_PATH = join(ROOT, "apps/dashboard/config/litellm-gateway.json");

const parse = (v: unknown) => LiteLLMGatewayConfigSchema.safeParse(v);
const ok = {
  operations: { resetMemberSpend: { enabled: false } },
  wildcardWarning: true,
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
        "removeTeamMember",
        "setMemberBudget",
        "setMemberLimits",
        "resetMemberSpend",
        "resetMemberBudget",
        "disableMember",
        "enableMember",
        "generateMemberKey",
        "updateMemberKey",
        "blockKey",
        "unblockKey",
        "deleteKey",
        "rotateKey",
      ].sort(),
    );
  });
});

describe("LiteLLMGatewayConfigSchema", () => {
  it("accepts per-operation enabled defaults and the wildcard warning", () => {
    expect(parse(ok).success).toBe(true);
  });

  it("accepts an empty operations map (the spec defaults then apply)", () => {
    expect(parse({ operations: {}, wildcardWarning: true }).success).toBe(true);
  });

  it("accepts a read operation (reads gain a toggle, LD19)", () => {
    expect(
      parse({ ...ok, operations: { getTeam: { enabled: false } } }).success,
    ).toBe(true);
  });

  it.each([
    ["an unknown operation", { deleteTeam: { enabled: true } }],
    ["a route used as an operation key", { "/team/delete": { enabled: true } }],
    ["an operation name in the wrong case", { getteam: { enabled: true } }],
  ])("rejects %s", (_n, operations) => {
    expect(parse({ ...ok, operations }).success).toBe(false);
  });

  it.each([
    ["a route", { enabled: true, route: "/team/delete" }],
    ["a routes list", { enabled: true, routes: ["/team/delete"] }],
    ["allowedRoutes", { enabled: true, allowedRoutes: ["/*"] }],
    ["a method", { enabled: true, method: "DELETE" }],
    ["a body field", { enabled: true, bodyFields: ["allowed_routes"] }],
    ["a body", { enabled: true, body: { user_role: "proxy_admin" } }],
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

  it("rejects a non-boolean wildcardWarning", () => {
    expect(parse({ ...ok, wildcardWarning: "yes" }).success).toBe(false);
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

describe("apps/dashboard/config/litellm-gateway.json", () => {
  it("exists, is valid JSON and parses with LiteLLMGatewayConfigSchema", () => {
    const json: unknown = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    expect(parse(json).success).toBe(true);
  });

  it("holds no secrets and only the two documented settings", () => {
    const json = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Record<
      string,
      unknown
    >;
    expect(Object.keys(json).sort()).toEqual(["operations", "wildcardWarning"]);
    expect(json.wildcardWarning).toBe(true);
  });
});
