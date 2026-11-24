import { vi } from "vitest";

import { createFakeLiteLLM } from "@/test/fakes/fake-litellm";
import type { FakeCall, FakeHandler } from "@/test/fakes/fake-litellm";
import {
  LTEAM,
  stubLiteLLMEnv,
  viewsHandler,
} from "@/test/fakes/fake-litellm-views";
import type { Suite } from "@/test/fakes/fake-litellm-views";

// Test-only harness for the SYNC1 route and sign-in suites (not imported by
// production code). The LiteLLM side is the in-process fake (Rule 60.24); the
// sync reads only `GET /user/list`, `GET /team/info` and `GET /user/info`
// (Access Control - "LiteLLM user sync": `searchUsers`, `getTeam`, `getUser`),
// so every other route of this handler answers 500 and `writeCalls` must stay
// empty (T-SY11).
export { LTEAM };

// A LiteLLM user as `GET /user/list` reports it. `sso` is `sso_user_id`, the
// Entra id key (Access Control - "Same person"); it must never leave the
// server, so it carries a sentinel-shaped value by default in the tests that
// check for leaks.
export type SyncUser = {
  id: string;
  email?: string | null;
  role?: string;
  sso?: string;
};

export type SyncFakeOptions = {
  users?: readonly SyncUser[];
  // LiteLLM team id -> its `members_with_roles` (user ids and LiteLLM role).
  teamMembers?: Record<string, ReadonlyArray<{ id: string; role?: string }>>;
  // Extra users with no email, to push `GET /user/list` past the page cap.
  generated?: number;
  outage?: boolean;
};

const PAGE_SIZE = 25;

const rowOf = (u: SyncUser) => ({
  user_id: u.id,
  user_email: u.email === undefined ? u.id : u.email,
  user_role: u.role ?? "internal_user",
  spend: 0,
  max_budget: null,
  teams: [] as string[],
  ...(u.sso ? { sso_user_id: u.sso } : {}),
});

export function syncHandler(opts: SyncFakeOptions = {}): FakeHandler {
  const real = (opts.users ?? []).map(rowOf);
  const fabricated = Array.from({ length: opts.generated ?? 0 }, (_v, i) =>
    rowOf({ id: `gen-${i}`, email: null }),
  );
  const all = [...real, ...fabricated];
  const views = viewsHandler();
  return (call: FakeCall, attempt: number) => {
    if (opts.outage) return "network-error";
    const q = new URL(call.url).searchParams;
    const route = `${call.method} ${call.path}`;
    if (route === "GET /user/list") {
      const page = Number(q.get("page") ?? 1);
      const size = Number(q.get("page_size") ?? PAGE_SIZE);
      return {
        status: 200,
        body: {
          users: all.slice((page - 1) * size, page * size),
          total: all.length,
          page,
          page_size: size,
          total_pages: Math.max(1, Math.ceil(all.length / size)),
        },
      };
    }
    if (route === "GET /user/info") {
      const id = q.get("user_id") ?? "";
      const found = all.find((u) => u.user_id === id);
      if (!found) return { status: 404, body: { detail: "user not found" } };
      return {
        status: 200,
        body: {
          user_id: id,
          user_info: {
            user_id: id,
            user_email: found.user_email,
            user_role: found.user_role,
            spend: 0,
            max_budget: null,
          },
          keys: [],
          teams: [],
        },
      };
    }
    if (route === "GET /team/info") {
      const teamId = q.get("team_id") ?? "";
      const members = opts.teamMembers?.[teamId] ?? [];
      return {
        status: 200,
        body: {
          team_id: teamId,
          team_info: {
            team_id: teamId,
            team_alias: "Alpha",
            max_budget: null,
            spend: 0,
            models: [],
            members_with_roles: members.map((m) => {
              const row = all.find((u) => u.user_id === m.id);
              return {
                user_id: m.id,
                user_email: row ? row.user_email : m.id,
                role: m.role ?? "user",
              };
            }),
          },
          keys: [],
          team_memberships: [],
        },
      };
    }
    if (call.method !== "GET") {
      return { status: 500, body: { detail: "the sync must not write" } };
    }
    return views(call, attempt);
  };
}

export function installSyncFake(state: Suite, opts: SyncFakeOptions = {}) {
  state.fake = createFakeLiteLLM(syncHandler(opts));
  vi.stubGlobal("fetch", state.fake.fetch);
}

// T-SY11: LiteLLM sees reads only.
export const writeCalls = (state: Suite) =>
  state.fake.calls.filter((c) => c.method !== "GET");

// Lets the sync write its pending links for `users` (nobody has an identity),
// then installs a fresh fake so a later call count starts at zero. The run is
// the one function of the contract: `runLiteLLMUserSync({ actor, trigger,
// mode, planHash? })` in `lib/litellm-user-sync/run.ts`. Callers do their own
// `stubLiteLLMEnv()` first; module state is reset by it.
export async function seedPendingLinksViaSync(
  state: Suite,
  users: readonly SyncUser[],
): Promise<void> {
  stubLiteLLMEnv();
  installSyncFake(state, { users });
  const { runLiteLLMUserSync } = await import("@/lib/litellm-user-sync/run");
  await runLiteLLMUserSync({
    actor: "system",
    trigger: "schedule",
    mode: "apply",
  });
  installSyncFake(state);
}

// A lease held by another run (LiteLLM spec - Data model additions,
// `UserSyncLock`: `owner`, `leaseUntil`, `expiresAt`).
export const heldLease = (leaseUntil: string) => ({
  PK: "LITELLM#USERSYNC",
  SK: "LOCK",
  owner: "other-run",
  leaseUntil,
  expiresAt: Math.floor(Date.parse(leaseUntil) / 1000) + 3600,
});
