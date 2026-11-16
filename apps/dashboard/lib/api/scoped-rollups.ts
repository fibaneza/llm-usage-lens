import "server-only";

import type { DatedDailyRollup } from "@llm-usage-lens/shared";
import type { Session } from "next-auth";
import { cache } from "react";

import { env } from "@/env";
import { can, resolveScope } from "@/lib/auth/policy";
import type { Scope } from "@/lib/auth/policy";
import { loadAuthorization } from "@/lib/data/access/authorization";

// Source: docs/specs/2026-11-10-access-control.md - "Enforcement" items 1-4.
// Scoping runs after the (scope-independent) cache read; the authorization
// data is read fresh on every request and never cached.

const unique = (values: Iterable<string>) => [...new Set(values)];

// One scope read per rendered request for the no-rollup call the layout and
// the page both make (Phase 4R.5). React's cache() lives for a single request
// and never across requests, so authorization data stays uncached (Rule 60.10);
// outside a render it does not memoize.
const renderScopes = cache(() => new Map<string, Promise<Scope>>());

const renderKey = (session: Session) =>
  JSON.stringify([
    session.user?.oid ?? null,
    session.user?.email ?? null,
    session.user?.roles ?? null,
  ]);

export function scopeFor(
  session: Session,
  rollups: readonly Pick<DatedDailyRollup, "teamId" | "departmentId">[],
  extra: {
    teamIds?: readonly string[];
    departmentIds?: readonly string[];
  } = {},
): Promise<Scope> {
  const bare =
    rollups.length === 0 &&
    (extra.teamIds ?? []).length === 0 &&
    (extra.departmentIds ?? []).length === 0;
  if (!bare) return readScope(session, rollups, extra);
  const memo = renderScopes();
  const key = renderKey(session);
  const hit = memo.get(key);
  if (hit) return hit;
  const read = readScope(session, rollups, extra);
  memo.set(key, read);
  return read;
}

async function readScope(
  session: Session,
  rollups: readonly Pick<DatedDailyRollup, "teamId" | "departmentId">[],
  extra: {
    teamIds?: readonly string[];
    departmentIds?: readonly string[];
  },
): Promise<Scope> {
  const input = await loadAuthorization({
    // t3-env guarantees dev | prod at runtime; only skipped validation
    // (tests) leaves it unset.
    appEnv: env.APP_ENV === "prod" ? "prod" : "dev",
    session,
    teamIds: unique([
      ...rollups.map((r) => r.teamId),
      ...(extra.teamIds ?? []),
    ]),
    departmentIds: unique([
      ...rollups.map((r) => r.departmentId),
      ...(extra.departmentIds ?? []),
    ]),
  });
  return resolveScope(input);
}

export function teamRollups(
  scope: Scope,
  rollups: readonly DatedDailyRollup[],
): DatedDailyRollup[] {
  return rollups.filter((r) =>
    can(scope, "read", {
      kind: "team",
      teamId: r.teamId,
      departmentId: r.departmentId,
      date: r.date,
    }),
  );
}

// A department's day is readable as a whole (all its teams that day) by a
// department-scope holder or a member of a team that was in it that day when
// its level is visible.
export function departmentRollups(
  scope: Scope,
  rollups: readonly DatedDailyRollup[],
): DatedDailyRollup[] {
  const memberDays = new Set(
    rollups
      .filter((r) => r.teamId === scope.memberTeamId)
      .map((r) => `${r.date}|${r.departmentId}`),
  );
  return rollups.filter((r) =>
    can(scope, "read", {
      kind: "department",
      departmentId: r.departmentId,
      viaMemberTeam: memberDays.has(`${r.date}|${r.departmentId}`),
    }),
  );
}

export function redactUsers(
  scope: Scope,
  rollups: readonly DatedDailyRollup[],
): DatedDailyRollup[] {
  return rollups.map((r) => {
    const ref = { teamId: r.teamId, departmentId: r.departmentId };
    const models = Object.fromEntries(
      Object.entries(r.models).map(([model, usage]) => [
        model,
        {
          ...usage,
          byUser: Object.fromEntries(
            Object.entries(usage.byUser).filter(([usageKey]) =>
              can(scope, "read", { kind: "user-row", ...ref, usageKey }),
            ),
          ),
        },
      ]),
    ) as DatedDailyRollup["models"];
    return { ...r, models };
  });
}
