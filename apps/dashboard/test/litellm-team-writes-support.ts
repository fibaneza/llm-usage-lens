import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeLiteLLM } from "@/test/fake-litellm";
import type { FakeCall, FakeHandler } from "@/test/fake-litellm";
import { NEW_KEY_VALUE, NEW_TOKEN } from "@/test/fake-litellm-gateway";
import {
  LTEAM,
  UNLINKED_LTEAM,
  enterProd,
  expectError,
  setToggles,
  setupViewsSuite,
} from "@/test/fake-litellm-views";
import type { Suite } from "@/test/fake-litellm-views";
import {
  AUDIT_DAY,
  BOB_LUSER,
  MEMBER_A_LUSER,
  bodyOf,
  callsTo,
  memberWritesHandler,
  seedMemberPeople,
  send,
  writeCalls,
} from "@/test/litellm-member-writes-support";
import type { MemberFakeOptions } from "@/test/litellm-member-writes-support";
import { CALLERS, signInAs } from "@/test/scope-fixtures";
import type { CallerName } from "@/test/scope-fixtures";
import { TEST_TABLE_NAME, testDoc } from "@/test/test-support";

// Test-only harness for the L4 slice 2 (key writes) and slice 3 (team
// settings) route suites; not imported by production code. Rule 60.22:
// DynamoDB Local, the real policy module and audit; only `@/auth` and the
// in-process fake LiteLLM are injected (Rule 60.24).
// Source: docs/specs/2026-11-10-litellm.md - "Allowlist -> Writes" (key and
// team rows), "Roles and rights", "Budgets and limits", "Audit", LD10, LD14,
// LT5, LT9, LT13, LT14, LT18; Access Control spec "Enforcement" 2, "Audit log"
// D17. Pattern of litellm-member-writes-support.ts (slice 1).

export {
  AUDIT_DAY,
  BOB_LUSER,
  CALLERS,
  LTEAM,
  MEMBER_A_LUSER,
  NEW_KEY_VALUE,
  NEW_TOKEN,
  UNLINKED_LTEAM,
  bodyOf,
  callsTo,
  enterProd,
  expectError,
  send,
  setToggles,
  signInAs,
  writeCalls,
};
export { BASE_URL, HOST, stubLiteLLMEnv } from "@/test/fake-litellm-views";
export { PEOPLE } from "@/test/matrix-route-support";
export { TOKEN_A, TOKEN_B, TOKEN_C } from "@/test/fake-litellm-views";

export const TOKEN_TEAM_B = "f".repeat(64);
export const TOKEN_UNKNOWN = "e".repeat(64);
export const NEW_LTEAM = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const TOKEN_A_ = "a".repeat(64);
const TOKEN_B_ = "b".repeat(64);
const TOKEN_C_ = "c".repeat(64);

export type TeamWritesFakeOptions = MemberFakeOptions & {
  // Merged over GET /team/info `team_info` (default: max_budget 100, soft 80,
  // rpm 60, tpm 6000, max_parallel_requests 4, models ["claude-sonnet"];
  // /models lists sonnet + haiku). The member's membership budget table
  // carries max_parallel_requests 3 (B4: key <= member and team).
  team?: Record<string, unknown>;
  // The member's membership carries no budget or limits (team limits apply).
  noMemberLimits?: boolean;
  // Merged over a GET /key/info row, by token hash.
  keys?: Record<string, Record<string, unknown>>;
};

const KEY_ROWS: Record<string, Record<string, unknown>> = {
  [TOKEN_A_]: {
    team_id: LTEAM["team-a"],
    user_id: MEMBER_A_LUSER,
    key_alias: "alias-a",
    models: ["claude-sonnet"],
    blocked: false,
    expires: null,
    max_budget: 10,
    rpm_limit: 5,
  },
  [TOKEN_B_]: {
    team_id: LTEAM["team-a"],
    user_id: BOB_LUSER,
    key_alias: "alias-b",
    models: ["claude-sonnet"],
    blocked: false,
    expires: null,
  },
  [TOKEN_C_]: {
    team_id: UNLINKED_LTEAM,
    user_id: MEMBER_A_LUSER,
    models: ["claude-sonnet"],
  },
  [TOKEN_TEAM_B]: {
    team_id: LTEAM["team-b"],
    user_id: "b1@company.com",
    models: ["claude-sonnet"],
  },
};

export function teamWritesHandler(
  opts: TeamWritesFakeOptions = {},
): FakeHandler {
  const inner = memberWritesHandler(opts);
  return (call: FakeCall, attempt: number) => {
    if (opts.outage) return "network-error";
    const route = `${call.method} ${call.path}`;
    const q = new URL(call.url).searchParams;
    if (route === "GET /team/info") {
      const reply = inner(call, attempt);
      if (typeof reply === "string" || !reply.body) return reply;
      const body = reply.body as {
        team_info: Record<string, unknown>;
        team_memberships: Array<Record<string, unknown>>;
      };
      return {
        status: reply.status,
        body: {
          ...body,
          team_info: {
            ...body.team_info,
            max_parallel_requests: 4,
            ...opts.team,
          },
          team_memberships: body.team_memberships.map((m) => ({
            ...m,
            litellm_budget_table: opts.noMemberLimits
              ? {}
              : {
                  ...(m.litellm_budget_table as Record<string, unknown>),
                  max_parallel_requests: 3,
                },
          })),
        },
      };
    }
    if (route === "GET /key/info") {
      const token = q.get("key") ?? "";
      const row = KEY_ROWS[token];
      if (!row) return { status: 404, body: { detail: "key not found" } };
      return {
        status: 200,
        body: { key: token, info: { token, ...row, ...opts.keys?.[token] } },
      };
    }
    if (route === "POST /key/generate") {
      return {
        status: 200,
        body: { key: NEW_KEY_VALUE, token: NEW_TOKEN, token_id: NEW_TOKEN },
      };
    }
    if (/^POST \/key\/[^/]+\/regenerate$/.test(route)) {
      return {
        status: 200,
        body: { key: NEW_KEY_VALUE, token: NEW_TOKEN, token_id: NEW_TOKEN },
      };
    }
    if (route === "POST /key/update" || route === "POST /key/delete") {
      return { status: 200, body: {} };
    }
    if (route === "POST /team/new") {
      return { status: 200, body: { team_id: NEW_LTEAM, team_alias: "New" } };
    }
    if (route === "POST /team/update") {
      return {
        status: 200,
        body: { team_id: (call.body as { team_id?: string }).team_id },
      };
    }
    return inner(call, attempt);
  };
}

export function installTeamWritesFake(
  state: Suite,
  opts: TeamWritesFakeOptions = {},
) {
  state.fake = createFakeLiteLLM(teamWritesHandler(opts));
  vi.stubGlobal("fetch", state.fake.fetch);
}

// Registers the suite hooks once per file: the L3 org, links, the member
// people, and the fake LiteLLM that accepts the key and team writes.
export function setupTeamWritesSuite(): Suite {
  const state = setupViewsSuite();
  beforeEach(async () => {
    await seedMemberPeople();
    installTeamWritesFake(state);
  });
  return state;
}

// ---- audit and secrecy -------------------------------------------------------

export async function auditWith(prefix: string) {
  const { listAuditRecords } = await import("@/lib/data/access/audit");
  return (await listAuditRecords(AUDIT_DAY)).filter((r) =>
    r.action.startsWith(prefix),
  );
}

// LT9: the issued key value is never stored - not in any DynamoDB item (audit
// rows included), never sent to LiteLLM, never logged.
export async function expectValueNeverStored(value: string, state: Suite) {
  const items: unknown[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await testDoc().send(
      new ScanCommand({
        TableName: TEST_TABLE_NAME,
        ExclusiveStartKey: startKey,
      }),
    );
    items.push(...(page.Items ?? []));
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  expect(JSON.stringify(items)).not.toContain(value);
  expect(JSON.stringify(state.fake.calls)).not.toContain(value);
}

export function spyOnLogs() {
  return (["log", "info", "warn", "error", "debug"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => undefined),
  );
}

export function expectNotLogged(
  spies: ReturnType<typeof spyOnLogs>,
  value: string,
) {
  for (const spy of spies) {
    expect(JSON.stringify(spy.mock.calls)).not.toContain(value);
  }
}

// ---- the shared role x operation contract (keys and team settings) ----------

type Who = CallerName | "noRole";
const signIn = async (who: Who) => {
  if (who === "noRole") {
    const { signInWithRoles } = await import("@/test/fake-litellm-views");
    await signInWithRoles([]);
  } else {
    signInAs(who);
  }
};

const MATRIX: Array<[Who, string, "allow" | 403 | 404]> = [
  ["teamAdminA", "team-a", "allow"],
  ["deptAdminEng", "team-a", "allow"],
  ["orgAdmin", "team-a", "allow"],
  ["admin", "team-a", "allow"],
  ["teamAdminA", "team-b", 404],
  ["deptAdminEng", "team-c", 404],
  ["memberA", "team-a", 403],
  ["auditor", "team-a", 403],
  ["noRole", "team-a", 403],
];

export type TeamScopedWriteSpec = {
  method: "POST" | "PATCH" | "PUT" | "DELETE";
  pattern: string;
  action: string;
  // "litellm.key." or "litellm.team." - the audit actions the suite reads.
  auditPrefix: string;
  toggleOp: string;
  defaultOff?: boolean;
  okStatus: 200 | 201;
  load: () => Promise<
    (
      req: Request,
      ctx: { params: Promise<Record<string, string>> },
    ) => Promise<Response>
  >;
  path: (teamId: string) => string;
  params: (teamId: string) => Record<string, string>;
  body?: unknown;
  // The audit target type the success record carries.
  targetType: "litellm-key" | "litellm-team";
};

// Registered once per route. Sources: LiteLLM spec "Roles and rights" (Lead
// in scope, org-admin and Admin write; Viewer, member, Auditor never),
// "Writes" (Who, toggle default, audit, the litellm-changed-by header, LD14),
// "Identity mapping and members" (unlinked team), Access Control Enforcement 2
// and D17. The 401, 403-before-parse, 400, no-store and one-denied-per-refusal
// cases belong to the shared route-contract suite (Rule 60.23).
export function defineTeamScopedWriteContract(
  state: Suite,
  spec: TeamScopedWriteSpec,
) {
  const run = async (team: string) =>
    send(await spec.load(), {
      method: spec.method,
      path: spec.path(team),
      params: spec.params(team),
      ...(spec.body === undefined ? {} : { body: spec.body }),
    });
  const prepare = async () => {
    if (spec.defaultOff) await setToggles({ [spec.toggleOp]: true });
  };

  describe(`${spec.method} ${spec.pattern}: role x operation (Roles and rights; Writes)`, () => {
    beforeEach(prepare);

    it.each(MATRIX)("%s on %s is %s", async (who, team, expected) => {
      await signIn(who);
      const { res, body } = await run(team);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      const records = await auditWith(spec.auditPrefix);
      if (expected === "allow") {
        expect(res.status).toBe(spec.okStatus);
        expect(body.data).toBeDefined();
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({
          action: spec.action,
          result: "success",
          category: "change",
          teamId: "team-a",
          target: { type: spec.targetType },
        });
        const writes = writeCalls(state);
        expect(writes.length).toBeGreaterThan(0);
        // LD14, LT19: every write names the acting person, from the session.
        const email = who === "noRole" ? "" : CALLERS[who].email;
        for (const w of writes) {
          expect(w.headers["litellm-changed-by"]).toBe(
            `llm-usage-lens:${email}`,
          );
        }
        return;
      }
      expect(res.status).toBe(expected);
      expect(body.error.code).toBe(
        expected === 403 ? "FORBIDDEN" : "NOT_FOUND",
      );
      expect(state.fake.calls).toHaveLength(0);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        action: spec.action,
        result: "denied",
        code: expected === 403 ? "FORBIDDEN" : "NOT_FOUND",
        route: { method: spec.method, pattern: spec.pattern },
      });
    });

    it("an out-of-scope team answers the same 404 body as a missing team (Enforcement 2)", async () => {
      signInAs("teamAdminA");
      const outOfScope = await run("team-b");
      const missing = await run("team-zzz");
      expect(outOfScope.res.status).toBe(404);
      expect(missing.res.status).toBe(404);
      expect(outOfScope.text).toBe(missing.text);
    });

    it("an in-scope team that is not linked to LiteLLM is 409 CONFLICT with no LiteLLM call (Identity mapping: not connected)", async () => {
      signInAs("admin");
      const { res } = await run("team-u");
      await expectError(res, 409, "CONFLICT");
      expect(state.fake.calls).toHaveLength(0);
    });

    it(`a disabled ${spec.toggleOp} is 403 OPERATION_DISABLED before any LiteLLM call, nothing audited (Toggles narrow only)`, async () => {
      await setToggles({ [spec.toggleOp]: false });
      signInAs("admin");
      const { res } = await run("team-a");
      await expectError(res, 403, "OPERATION_DISABLED");
      expect(state.fake.calls).toHaveLength(0);
      expect(await auditWith(spec.auditPrefix)).toHaveLength(0);
    });

    it("a LiteLLM outage is 503 LITELLM_UNAVAILABLE without upstream detail and writes one failed audit record (error codes; Audit)", async () => {
      installTeamWritesFake(state, { outage: true });
      signInAs("admin");
      const { res, text } = await run("team-a");
      await expectError(res, 503, "LITELLM_UNAVAILABLE");
      expect(text).not.toContain("fetch failed");
      const records = await auditWith(spec.auditPrefix);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        action: spec.action,
        result: "failed",
        teamId: "team-a",
      });
      expect(records[0]?.target).toBeDefined();
    });
  });
}

// The five routes that name a key by token hash (update, delete, block,
// unblock, rotate): the token is accepted only after /key/info confirms its
// team_id is the linked team, else 404 with no write (Resolution; LT5).
export function defineKeyTokenContract(
  state: Suite,
  spec: Pick<
    TeamScopedWriteSpec,
    "method" | "toggleOp" | "defaultOff" | "load"
  > & {
    pathFor: (teamId: string, token: string) => string;
    body?: unknown;
  },
) {
  const run = async (token: string) =>
    send(await spec.load(), {
      method: spec.method,
      path: spec.pathFor("team-a", token),
      params: { teamId: "team-a", tokenId: token },
      ...(spec.body === undefined ? {} : { body: spec.body }),
    });

  describe(`${spec.method} key by token: team confirmation (Resolution; LT5)`, () => {
    beforeEach(async () => {
      if (spec.defaultOff) await setToggles({ [spec.toggleOp]: true });
      signInAs("admin");
    });

    it.each([
      ["another linked team's key", TOKEN_TEAM_B],
      ["a key of a team the dashboard does not link", TOKEN_C_],
      ["a token LiteLLM does not know", TOKEN_UNKNOWN],
    ])("%s is 404 NOT_FOUND with no LiteLLM write", async (_name, token) => {
      const { res } = await run(token);
      await expectError(res, 404, "NOT_FOUND");
      expect(writeCalls(state)).toHaveLength(0);
    });

    it("a key of the linked team is confirmed with /key/info before the write", async () => {
      const { res } = await run(TOKEN_A_);
      expect(res.status).toBeLessThan(300);
      const first = state.fake.calls.findIndex((c) => c.path === "/key/info");
      const firstWrite = state.fake.calls.findIndex((c) => c.method !== "GET");
      expect(first).toBeGreaterThanOrEqual(0);
      expect(first).toBeLessThan(firstWrite);
      expect(callsTo(state, "GET /key/info")[0]?.url).toContain(TOKEN_A_);
    });
  });
}
