import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { LITELLM_OPERATION_NAMES } from "@llm-usage-lens/shared";
import { describe, expect, it } from "vitest";

import {
  LITELLM_OPERATIONS,
  LITELLM_SERVICE_KEY_ALLOWED_ROUTES,
} from "./allowlist";

// Source: docs/specs/2026-11-10-litellm.md — "Allowlist (the gateway)" (one
// typed function per row; a structural test fails when the gateway's set
// differs from the table), "Service key allowed_routes" (the list, the
// runbook's list and the gateway's paths are equal; the two temporary
// wildcards are compared as written), "Gateway guardrails" items 1, 3, 6,
// threats LT3, LT7, LT14; implementation-phases L2 Verify.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const SPEC = join(ROOT, "docs/specs/2026-11-10-litellm.md");
const RUNBOOK = join(ROOT, "docs/guides/litellm-admin.md");

type Kind = "read" | "write";
// [kind, default enabled, sorted "METHOD template" routes]
const EXPECTED: Record<string, [Kind, boolean, string[]]> = {
  getTeam: ["read", true, ["GET /team/info"]],
  listProxyTeams: ["read", true, ["GET /team/list"]],
  getTeamDailySpend: ["read", true, ["GET /team/daily/activity/aggregated"]],
  getUser: ["read", true, ["GET /user/info"]],
  findUserByEmail: ["read", true, ["GET /user/list"]],
  searchUsers: ["read", true, ["GET /user/list"]], // L3b, LT3
  getUserDailySpend: ["read", true, ["GET /user/daily/activity"]],
  listKeys: ["read", true, ["GET /key/list"]],
  getKey: ["read", true, ["GET /key/info"]],
  listSpendLogs: ["read", true, ["GET /spend/logs/v2"]],
  listProxyModels: ["read", true, ["GET /models"]],
  listProxyAuditLog: ["read", true, ["GET /audit"]],
  getGlobalSpendReport: ["read", true, ["GET /global/spend/report"]],
  createTeam: ["write", true, ["POST /team/new"]],
  setTeamBudget: ["write", true, ["POST /team/update"]],
  setTeamLimits: ["write", true, ["POST /team/update"]],
  setTeamModels: ["write", true, ["POST /team/update"]],
  addTeamMember: [
    "write",
    true,
    ["GET /user/list", "POST /team/member_add", "POST /user/new"],
  ],
  // Writes table, `createUser` (management improvements D16; M3 Verify): toggle
  // default on; the findUserByEmail pre-check reads GET /user/list first.
  createUser: ["write", true, ["GET /user/list", "POST /user/new"]],
  removeTeamMember: ["write", true, ["POST /team/member_delete"]],
  setMemberBudget: ["write", true, ["POST /team/member_update"]],
  setMemberLimits: ["write", true, ["POST /team/member_update"]],
  resetMemberSpend: [
    "write",
    false,
    ["POST /team/{team_id}/member/{user_id}/reset_spend"],
  ],
  resetMemberBudget: [
    "write",
    true,
    ["POST /team/{team_id}/member/{user_id}/reset_budget"],
  ],
  disableMember: ["write", true, ["GET /key/list", "POST /key/block"]],
  enableMember: ["write", true, ["GET /key/list", "POST /key/unblock"]],
  generateMemberKey: ["write", true, ["POST /key/generate"]],
  updateMemberKey: ["write", true, ["POST /key/update"]],
  blockKey: ["write", true, ["POST /key/block"]],
  unblockKey: ["write", true, ["POST /key/unblock"]],
  deleteKey: ["write", false, ["POST /key/delete"]],
  rotateKey: [
    "write",
    true,
    ["POST /key/block", "POST /key/generate", "POST /key/{key}/regenerate"],
  ],
  // M4, MG-D11a: dashboard-only, no LiteLLM route; on by default (a request
  // alone changes nothing in LiteLLM).
  requestBudgetReset: ["write", true, []],
};

const routeKey = (r: { method: string; template: string }) =>
  `${r.method} ${r.template}`;

describe("the gateway registry matches the allowlist table", () => {
  it("has exactly the operations of the table (and the shared name list)", () => {
    expect(Object.keys(LITELLM_OPERATIONS).sort()).toEqual(
      Object.keys(EXPECTED).sort(),
    );
    expect([...LITELLM_OPERATION_NAMES].sort()).toEqual(
      Object.keys(EXPECTED).sort(),
    );
  });

  it.each(Object.entries(EXPECTED))(
    "%s: kind, LD10 default and method + route templates",
    (name, [kind, defaultEnabled, routes]) => {
      const op = (
        LITELLM_OPERATIONS as Record<
          string,
          {
            kind: Kind;
            defaultEnabled: boolean;
            routes: ReadonlyArray<{ method: string; template: string }>;
          }
        >
      )[name];
      expect(op?.kind).toBe(kind);
      expect(op?.defaultEnabled).toBe(defaultEnabled);
      expect(op?.routes.map(routeKey).sort()).toEqual([...routes].sort());
    },
  );

  it("LD10: only resetMemberSpend and deleteKey default off (L7 operations land in L7)", () => {
    const off = Object.entries(LITELLM_OPERATIONS)
      .filter(([, op]) => !op.defaultEnabled)
      .map(([n]) => n)
      .sort();
    expect(off).toEqual(["deleteKey", "resetMemberSpend"]);
  });

  it("LT7/LT14: no bulk, model-write, config, organization, agent, delete-team or passthrough route", () => {
    const templates = Object.values(LITELLM_OPERATIONS).flatMap((op) =>
      op.routes.map((r) => r.template),
    );
    for (const t of templates) {
      expect(t).not.toMatch(
        /bulk|^\/model\/|^\/config|^\/organization|^\/v1\/|^\/global\/spend\/reset|^\/team\/(delete|block|unblock)$|service-account|^\/chat|^\/completions|^\/key\/regenerate$/,
      );
    }
  });

  it("every write route is a POST and every read route a GET", () => {
    for (const op of Object.values(LITELLM_OPERATIONS)) {
      for (const r of op.routes) {
        if (r.method === "GET") continue;
        expect(op.kind).toBe("write");
        expect(r.method).toBe("POST");
      }
    }
  });
});

// ---- allowed_routes = runbook = spec = gateway path set (LT3) ----

function fencedAfter(file: string, heading: RegExp): string[] {
  const text = readFileSync(file, "utf8");
  const start = text.search(heading);
  expect(start, `heading ${heading} in ${file}`).toBeGreaterThanOrEqual(0);
  const after = text.slice(start);
  const open = after.indexOf("```");
  const body = after.slice(open + 3);
  const block = body.slice(body.indexOf("\n") + 1, body.indexOf("```"));
  return block
    .split("\n")
    .map((l) => l.replace(/\s*\(.*\)\s*$/, "").trim())
    .filter((l) => l !== "");
}

const specList = () => fencedAfter(SPEC, /### Service key `allowed_routes`/);
const runbookList = () =>
  fencedAfter(RUNBOOK, /## 3\. `allowed_routes` \(must equal/);

const covers = (entry: string, template: string) =>
  entry === template ||
  (entry.endsWith("/*") && template.startsWith(entry.slice(0, -1)));

describe("service key allowed_routes (LT3)", () => {
  it("the code constant equals the spec list and the runbook list, as written", () => {
    expect([...LITELLM_SERVICE_KEY_ALLOWED_ROUTES]).toEqual(specList());
    expect([...LITELLM_SERVICE_KEY_ALLOWED_ROUTES]).toEqual(runbookList());
  });

  it("createUser needs no new allowed_routes entry: /user/new and /user/list are in the spec and runbook lists (Writes: createUser, Service key; M3 Verify)", () => {
    for (const list of [specList(), runbookList()]) {
      expect(list).toContain("/user/new");
      expect(list).toContain("/user/list");
    }
  });

  it("carries exactly the two temporary wildcards and no other wildcard", () => {
    const wild = LITELLM_SERVICE_KEY_ALLOWED_ROUTES.filter((r) =>
      r.includes("*"),
    );
    expect([...wild].sort()).toEqual(["/key/*", "/team/*"]);
  });

  it("every gateway path is covered by an allowed_routes entry", () => {
    const templates = new Set(
      Object.values(LITELLM_OPERATIONS).flatMap((op) =>
        op.routes.map((r) => r.template),
      ),
    );
    for (const t of templates) {
      expect(
        LITELLM_SERVICE_KEY_ALLOWED_ROUTES.some((e) => covers(e, t)),
        `${t} is not covered by allowed_routes`,
      ).toBe(true);
    }
  });

  it("every non-wildcard allowed_routes entry is a gateway path (nothing extra)", () => {
    const templates = new Set(
      Object.values(LITELLM_OPERATIONS).flatMap((op) =>
        op.routes.map((r) => r.template),
      ),
    );
    for (const e of LITELLM_SERVICE_KEY_ALLOWED_ROUTES.filter(
      (r) => !r.includes("*"),
    )) {
      expect(templates.has(e), `${e} is not a gateway path`).toBe(true);
    }
  });

  it("only the three templated gateway paths need a wildcard", () => {
    const templated = new Set(
      Object.values(LITELLM_OPERATIONS).flatMap((op) =>
        op.routes.map((r) => r.template).filter((t) => t.includes("{")),
      ),
    );
    expect([...templated].sort()).toEqual([
      "/key/{key}/regenerate",
      "/team/{team_id}/member/{user_id}/reset_budget",
      "/team/{team_id}/member/{user_id}/reset_spend",
    ]);
  });
});

// ---- the choke point is the only door (Gateway guardrails item 1) ----

const SKIP = new Set(["node_modules", ".next", "cdk.out", "dist", ".git"]);
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}
const rel = (f: string) => relative(ROOT, f).split(sep).join("/");
const isProd = (f: string) =>
  /\.(ts|tsx)$/.test(f) &&
  !/\.(test|spec)\.(ts|tsx)$/.test(f) &&
  !/\/test\//.test(rel(f));

describe("one outbound choke point (Gateway guardrails item 1)", () => {
  const appDir = join(ROOT, "apps/dashboard");
  const files = existsSync(appDir) ? walk(appDir).filter(isProd) : [];

  it("only client.ts calls fetch for LiteLLM (no other module under lib/litellm or app/api/litellm)", () => {
    const offenders = files
      .map(rel)
      .filter(
        (p) =>
          (p.startsWith("apps/dashboard/lib/litellm/") ||
            p.startsWith("apps/dashboard/app/api/litellm/")) &&
          p !== "apps/dashboard/lib/litellm/client.ts",
      )
      .filter((p) => /\bfetch\s*\(/.test(readFileSync(join(ROOT, p), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("callLiteLLM (the raw sender) is referenced only by client.ts and gateway.ts", () => {
    const offenders = files
      .map(rel)
      .filter(
        (p) =>
          p !== "apps/dashboard/lib/litellm/client.ts" &&
          p !== "apps/dashboard/lib/litellm/gateway.ts",
      )
      .filter((p) =>
        /\bcallLiteLLM\b/.test(readFileSync(join(ROOT, p), "utf8")),
      );
    expect(offenders).toEqual([]);
  });

  it("gateway.ts exists and exports the choke point", () => {
    const gw = join(ROOT, "apps/dashboard/lib/litellm/gateway.ts");
    expect(existsSync(gw)).toBe(true);
    const src = readFileSync(gw, "utf8");
    expect(src).toMatch(/export (async )?function callAllowlisted\b/);
    expect(src).toMatch(/export class LiteLLMRouteNotAllowed\b/);
  });

  it("no production module under lib/litellm builds a path from caller input outside the choke point", () => {
    // Paths are templates ("/team/{team_id}/...") resolved only inside
    // gateway.ts; no other module concatenates "/team/" or "/key/" itself.
    const offenders = files
      .map(rel)
      .filter(
        (p) =>
          p.startsWith("apps/dashboard/lib/litellm/") &&
          !["gateway.ts", "allowlist.ts", "client.ts"].includes(
            p.split("/").pop() ?? "",
          ),
      )
      .filter((p) =>
        /`\/(team|key|user)\/\$\{|["']\/(team|key|user)\/["']\s*\+/.test(
          readFileSync(join(ROOT, p), "utf8"),
        ),
      );
    expect(offenders).toEqual([]);
  });
});
