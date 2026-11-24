// Test-only helpers for the LiteLLM user sync domain suites (unit SYNC1; not
// imported by production code). Source: docs/specs/2026-11-10-access-control.md
// - "LiteLLM user sync" (the sync only reads LiteLLM: `searchUsers`, `getTeam`,
// `getUser`; T-SY11). The fake LiteLLM answers those three reads from mutable
// state and records every call, so a test can prove the sync wrote nothing.
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { vi } from "vitest";

import { createFakeLiteLLM } from "@/test/fakes/fake-litellm";
import type { FakeCall, FakeHandler } from "@/test/fakes/fake-litellm";
import { TEST_TABLE_NAME, testDoc } from "@/test/support/test-support";

export const LITELLM_BASE = "http://litellm.test:4000";
export const READ_PATHS = ["/user/list", "/user/info", "/team/info"] as const;

export type SyncFakeUser = {
  userId: string;
  email: string | null;
  role?: string;
  ssoUserId?: string;
  teams?: string[];
};
export type SyncFakeTeam = {
  members: {
    userId: string;
    email: string | null;
    role?: "user" | "admin";
  }[];
};
export type SyncFakeState = {
  users: SyncFakeUser[];
  teams: Record<string, SyncFakeTeam>;
  // Users `/user/list` never shows but `/user/info` still answers.
  hiddenFromList: Set<string>;
  // Answer `/user/list` with this many pages, one synthetic user a page.
  syntheticPages: number | null;
  listFails: boolean;
};

export const newSyncState = (): SyncFakeState => ({
  users: [],
  teams: {},
  hiddenFromList: new Set(),
  syntheticPages: null,
  listFails: false,
});

const row = (u: SyncFakeUser) => ({
  user_id: u.userId,
  user_email: u.email,
  user_role: u.role ?? "internal_user",
  ...(u.ssoUserId ? { sso_user_id: u.ssoUserId } : {}),
  spend: 0,
  max_budget: null,
  teams: u.teams ?? [],
});

export function syncHandler(state: SyncFakeState): FakeHandler {
  return (call: FakeCall) => {
    const q = new URL(call.url).searchParams;
    if (call.method !== "GET") return { status: 500, body: {} };
    switch (call.path) {
      case "/user/list": {
        if (state.listFails) return "network-error";
        const page = Number(q.get("page") ?? 1);
        const size = Number(q.get("page_size") ?? 25);
        if (state.syntheticPages !== null) {
          const inRange = page <= state.syntheticPages;
          return {
            status: 200,
            body: {
              users: inRange
                ? [
                    row({
                      userId: `bulk-${page}`,
                      email: `bulk-${page}@company.com`,
                    }),
                  ]
                : [],
              total: state.syntheticPages,
              page,
              page_size: size,
              total_pages: state.syntheticPages,
            },
          };
        }
        const visible = state.users.filter(
          (u) => !state.hiddenFromList.has(u.userId),
        );
        return {
          status: 200,
          body: {
            users: visible.slice((page - 1) * size, page * size).map(row),
            total: visible.length,
            page,
            page_size: size,
            total_pages: Math.max(1, Math.ceil(visible.length / size)),
          },
        };
      }
      case "/user/info": {
        const id = q.get("user_id");
        const user = state.users.find((u) => u.userId === id);
        if (!user) return { status: 404, body: { detail: "not found" } };
        return {
          status: 200,
          body: {
            user_id: user.userId,
            user_info: {
              user_id: user.userId,
              user_email: user.email,
              user_role: user.role ?? "internal_user",
              spend: 0,
            },
            keys: [],
            teams: [],
          },
        };
      }
      case "/team/info": {
        const id = q.get("team_id") ?? "";
        const team = state.teams[id];
        if (!team) return { status: 404, body: { detail: "not found" } };
        return {
          status: 200,
          body: {
            team_id: id,
            team_info: {
              team_id: id,
              team_alias: id,
              members_with_roles: team.members.map((m) => ({
                user_id: m.userId,
                user_email: m.email,
                role: m.role ?? "user",
              })),
            },
            keys: [],
            team_memberships: [],
          },
        };
      }
      default:
        return { status: 404, body: { detail: "not found" } };
    }
  };
}

export function installSyncFake(state: SyncFakeState) {
  const fake = createFakeLiteLLM(syncHandler(state));
  vi.stubGlobal("fetch", fake.fetch);
  return fake;
}

// T-SY11: every call the sync made is a GET of one of the three read routes.
export const nonReadCalls = (fake: { calls: FakeCall[] }): FakeCall[] =>
  fake.calls.filter(
    (c) =>
      c.method !== "GET" || !(READ_PATHS as readonly string[]).includes(c.path),
  );

export const pagesRead = (fake: { calls: FakeCall[] }): number[] =>
  fake.calls
    .filter((c) => c.path === "/user/list")
    .map((c) => Number(new URL(c.url).searchParams.get("page") ?? 1));

export function stubSyncEnv(issuer: string): void {
  vi.resetModules();
  const vars: Record<string, string> = {
    APP_ENV: "dev",
    AUTH_ACCESS_MODE: "enforce",
    LITELLM_ALLOWED_HOSTS: "litellm.test:4000",
    LITELLM_SERVICE_KEY: "sk-fake-key-000",
    AUTH_MICROSOFT_ENTRA_ID_ID: "client-id-test",
    AUTH_MICROSOFT_ENTRA_ID_ISSUER: issuer,
  };
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
}

export async function allItems(): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
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
  return items;
}

export const keyOf = (item: Record<string, unknown>): string =>
  `${String(item.PK)} | ${String(item.SK)}`;

// A loose view of the run result: the suites assert on these fields only, so a
// production type that adds fields never breaks a test (contract in the
// run.integration.test.ts header).
export type PlanRow = {
  litellmUserId: string;
  outcome: string;
  reason?: string;
  oid?: string;
  key?: string;
  matchedKey?: string;
};
export type RunView = {
  ok: boolean;
  code?: string;
  value?: {
    runId?: string;
    remaining?: number;
    applied?: number;
    skipped?: string;
    notes?: string[];
    unplaced?: { litellmUserId: string; reason: string }[];
    plan?: {
      planHash: string;
      truncated: boolean;
      users: PlanRow[];
      drift?: { oid: string; teamId: string }[];
      notes?: string[];
    };
  };
};
