import "server-only";

import { randomUUID } from "node:crypto";

import { runBounded } from "@llm-usage-lens/shared";

import { addMember } from "@/lib/data/access/affiliations";
import { getAllAccounts } from "@/lib/data/account-meta";
import { listAppTeams } from "@/lib/data/access/app-teams";
import {
  matchLiteLLMUser,
  normalizeEmail,
} from "@/lib/data/access/litellm-match";
import { listSyncPeople } from "@/lib/data/access/litellm-sync-people";
import type { SyncPerson } from "@/lib/data/access/litellm-sync-people";
import { writeLiteLLMUserLink } from "@/lib/data/access/identity-links";
import { createPendingItem, listPendingFor } from "@/lib/data/access/pending";
import {
  createPendingLiteLLMLink,
  listPendingLiteLLMLinks,
  removePendingLiteLLMLink,
} from "@/lib/data/access/pending-litellm-links";
import type { AccessErrorCode, AuditContext } from "@/lib/data/access/result";
import { configuredTenant } from "@/lib/data/access/sso-binding";
import { listTeamLinks } from "@/lib/data/litellm/team-links";
import { getOperationToggles } from "@/lib/data/litellm/toggles";
import {
  acquireUserSyncLease,
  releaseUserSyncLease,
  renewUserSyncLease,
} from "@/lib/data/litellm/user-sync-lock";
import { LiteLLMError } from "@/lib/litellm/client";
import { loadGatewayConfig } from "@/lib/litellm/gateway-config";
import { getTeam, getUser, searchUsers } from "@/lib/litellm/operations";
import { resolveOperationSettings } from "@/lib/litellm/operation-settings";

import {
  PERSON_ROLES,
  classifyLiteLLMUsers,
  planHash,
  staleCandidates,
} from "./plan";
import type { HashRow, PlanPending, PlanRow, PlanUser } from "./plan";
import { writeSyncSummary } from "./summary";

// Source: docs/specs/2026-11-10-access-control.md - "LiteLLM user sync" (the
// user's rules, *Users*, *Pending LiteLLM links*, *Clean-up of dashboard
// placeholders*, *Teams*, *Scheduled run*, *Preview and apply*, *Records*,
// T-SY1 to T-SY12) and LiteLLM spec LD40. The one function the on-demand
// routes and the scheduled job call. It never writes to LiteLLM: only
// `searchUsers`, `getTeam` and `getUser` are imported (S16, T-SY11). It
// imports nothing from `next/*`, so the job can run it outside Next.

const PAGE_SIZE = 25;
const MAX_PAGES_MANUAL = 80;
const MAX_PAGES_SCHEDULE = 400;
const MAX_CHANGES = 500;
const BATCH = 25;
const READ_CONCURRENCY = 5;
const REMOVAL_MAX = 20;
const SYSTEM = "system";

export type SyncTrigger = "manual" | "schedule";
export type RunInput = {
  actor: string;
  trigger: SyncTrigger;
  mode: "preview" | "apply";
  planHash?: string;
};

export type SyncUserRow = PlanRow & { email: string };
export type SyncMembershipRow = {
  litellmUserId: string;
  teamId: string;
  outcome: "add-member" | "add-pending-member" | "skip";
  reason?: "multiple-teams" | "other-team" | "own-identity";
  // The person to place: an identity, or the pending person's email.
  oid?: string;
  key?: string;
};
export type SyncRemovalRow = {
  litellmUserId: string;
  outcome: "remove-pending";
  key: string;
  reason?: "removal-guard";
};
export type SyncDriftRow = {
  kind: "not-in-litellm-team" | "not-in-litellm";
  oid: string;
  teamId?: string;
};
export type SyncUnplacedRow = {
  litellmUserId: string;
  reason: "multiple-teams" | "other-team" | "no-linked-team";
};

export type SyncPlan = {
  planHash: string;
  truncated: boolean;
  users: SyncUserRow[];
  removals: SyncRemovalRow[];
  memberships: SyncMembershipRow[];
  drift: SyncDriftRow[];
  notPlaced: SyncUnplacedRow[];
  notes: string[];
  counts: {
    toLink: number;
    toPend: number;
    alreadyLinked: number;
    skipped: number;
    memberships: number;
  };
};

export type SyncResultRow = {
  litellmUserId: string;
  outcome: string;
  status: "applied" | "refused";
  reason?: string;
};

export type RunValue = {
  plan?: SyncPlan;
  runId?: string;
  applied?: number;
  remaining?: number;
  unplaced?: SyncUnplacedRow[];
  notes?: string[];
  results?: { users: SyncResultRow[]; memberships: SyncResultRow[] };
  skipped?: "disabled" | "locked" | "lost-lease";
};

export type RunResult =
  | { ok: true; value: RunValue }
  | { ok: false; code: "PLAN_CHANGED" | "PLAN_TRUNCATED" | "SYNC_RUNNING" };

type PendingRef = { key: string; version: number; litellmUserId: string };

type BuiltPlan = {
  plan: SyncPlan;
  people: Map<string, SyncPerson>;
  pendingByUser: Map<string, PendingRef>;
};

// ---- LiteLLM reads --------------------------------------------------------

const readPage = (page: number) =>
  searchUsers({ page, pageSize: PAGE_SIZE, withIdentity: true });

async function readUsers(
  maxPages: number,
): Promise<{ users: PlanUser[]; truncated: boolean }> {
  const seen = new Map<string, PlanUser>();
  const take = (page: Awaited<ReturnType<typeof readPage>>) => {
    for (const u of page.users) {
      if (seen.has(u.user_id)) continue;
      seen.set(u.user_id, {
        userId: u.user_id,
        email: u.user_email ?? null,
        role: u.user_role ?? null,
        ssoUserId: u.sso_user_id ?? null,
        teams: u.teams ?? [],
      });
    }
  };
  const first = await readPage(1);
  take(first);
  const known = first.total_pages ?? null;
  if (known === null) {
    let page = 1;
    let last = first;
    while (last.users.length >= PAGE_SIZE && page < maxPages) {
      page += 1;
      last = await readPage(page);
      take(last);
    }
    return {
      users: [...seen.values()],
      truncated: last.users.length >= PAGE_SIZE && page >= maxPages,
    };
  }
  const pages = Math.min(known, maxPages);
  const rest = Array.from({ length: Math.max(0, pages - 1) }, (_, i) => i + 2);
  const results = new Map<number, Awaited<ReturnType<typeof readPage>>>();
  await runBounded(rest, READ_CONCURRENCY, async (page) => {
    results.set(page, await readPage(page));
  });
  for (const page of rest) {
    const result = results.get(page);
    if (result) take(result);
  }
  return { users: [...seen.values()], truncated: known > maxPages };
}

const isNotFound = (error: unknown): boolean =>
  error instanceof LiteLLMError && error.status === 404;

// A placeholder is removed only when `getUser` confirms: the user is gone, no
// longer a person, or has another email than the key.
async function confirmedRemovals(
  candidates: readonly PlanPending[],
): Promise<PlanPending[]> {
  const confirmed: PlanPending[] = [];
  await runBounded(candidates, READ_CONCURRENCY, async (p) => {
    let info: Awaited<ReturnType<typeof getUser>>;
    try {
      info = await getUser({ litellmUserId: p.litellmUserId });
    } catch (error) {
      if (isNotFound(error)) {
        confirmed.push(p);
        return;
      }
      throw error;
    }
    const role = info.user_info?.user_role ?? null;
    if (role === null || !PERSON_ROLES.includes(role)) {
      confirmed.push(p);
      return;
    }
    const email = normalizeEmail(info.user_info?.user_email);
    if (p.key.includes("@") && email !== p.key) confirmed.push(p);
  });
  return candidates.filter((p) => confirmed.includes(p));
}

type TeamMembers = {
  teamId: string;
  litellmTeamId: string;
  members: { userId: string; email: string | null }[];
};

async function readLinkedTeams(): Promise<TeamMembers[]> {
  const [links, accounts, appTeams] = await Promise.all([
    listTeamLinks(),
    getAllAccounts(),
    listAppTeams(),
  ]);
  const known = new Set([
    ...accounts.map((a) => a.teamId),
    ...appTeams.map((t) => t.teamId),
  ]);
  const usable = links.filter((l) => known.has(l.teamId));
  const found: TeamMembers[] = [];
  await runBounded(usable, READ_CONCURRENCY, async (link) => {
    try {
      const info = await getTeam({ litellmTeamId: link.litellmTeamId });
      found.push({
        teamId: link.teamId,
        litellmTeamId: link.litellmTeamId,
        members: (info.team_info.members_with_roles ?? []).flatMap((m) =>
          m.user_id ? [{ userId: m.user_id, email: m.user_email ?? null }] : [],
        ),
      });
    } catch (error) {
      // A team link whose LiteLLM team is gone places nobody and does not
      // fail the run (Teams).
      if (!isNotFound(error)) throw error;
    }
  });
  return usable.flatMap((l) => found.filter((f) => f.teamId === l.teamId));
}

// ---- the plan -------------------------------------------------------------

async function syncEnabled(): Promise<boolean> {
  const saved = await getOperationToggles();
  const settings = resolveOperationSettings({
    file: loadGatewayConfig(),
    saved: saved?.toggles ?? null,
  });
  return settings.syncLiteLLMUsers.enabled;
}

const pendingEmail = (row: PlanRow, user: PlanUser | undefined) => {
  if (row.key?.includes("@")) return row.key;
  const email = normalizeEmail(user?.email);
  return email.includes("@") ? email : null;
};

async function buildPlan(
  trigger: SyncTrigger,
  callerOid: string | null,
): Promise<BuiltPlan> {
  const maxPages =
    trigger === "schedule" ? MAX_PAGES_SCHEDULE : MAX_PAGES_MANUAL;
  const [read, directory, pendingLinks, teams] = await Promise.all([
    readUsers(maxPages),
    listSyncPeople(),
    listPendingLiteLLMLinks(),
    readLinkedTeams(),
  ]);
  const { users } = read;
  const truncated = read.truncated || directory.truncated;
  const people = new Map(directory.people.map((p) => [p.oid, p]));
  const tenant = configuredTenant();
  const userById = new Map(users.map((u) => [u.userId, u]));

  const pending: PlanPending[] = pendingLinks.map((p) => ({
    key: p.emailOrOid,
    litellmUserId: p.litellmUserId,
  }));
  const pendingByUser = new Map<string, PendingRef>(
    pendingLinks.map((p) => [
      p.litellmUserId,
      { key: p.emailOrOid, version: p.version, litellmUserId: p.litellmUserId },
    ]),
  );
  const claims: Record<string, string> = {};
  for (const p of directory.people) {
    if (p.litellmUserId) claims[p.litellmUserId] = p.oid;
  }
  for (const p of pending) claims[p.litellmUserId] ??= p.key;

  const rows = classifyLiteLLMUsers({
    users,
    people: directory.people,
    pending,
    claims,
    tenant,
    serviceUserId: null,
    callerOid,
  });

  // Clean-up of placeholders: only against a complete list, only after
  // `getUser` confirms, never more than 20 or 10 % at once.
  const candidates = truncated ? [] : staleCandidates(pending, users, null);
  const confirmed = await confirmedRemovals(candidates);
  const guarded =
    confirmed.length > REMOVAL_MAX || confirmed.length * 10 > pending.length;
  const removals: SyncRemovalRow[] = confirmed.map((p) => ({
    litellmUserId: p.litellmUserId,
    outcome: "remove-pending",
    key: p.key,
    ...(guarded ? { reason: "removal-guard" as const } : {}),
  }));
  const notes = guarded && confirmed.length > 0 ? ["removal-guard"] : [];

  // Teams.
  const memberships: SyncMembershipRow[] = [];
  const notPlaced = new Map<string, SyncUnplacedRow>();
  const teamIdsOf = (userId: string) =>
    teams.filter((t) => t.members.some((m) => m.userId === userId));
  const pendingAffiliationTeam = new Map<string, string | null>();
  for (const row of rows) {
    const user = userById.get(row.litellmUserId);
    const candidatesOf = teamIdsOf(row.litellmUserId).map((t) => t.teamId);
    if (row.outcome === "skip") {
      if (row.reason === "own-identity" && candidatesOf[0] !== undefined) {
        memberships.push({
          litellmUserId: row.litellmUserId,
          teamId: candidatesOf[0],
          outcome: "skip",
          reason: "own-identity",
        });
      }
      continue;
    }
    const person = row.oid ? people.get(row.oid) : undefined;
    const email = person ? null : pendingEmail(row, user);
    let current: string | null = person?.affiliation?.teamId ?? null;
    if (!person && candidatesOf.length > 0 && email) {
      if (!pendingAffiliationTeam.has(email)) {
        const items = await listPendingFor([email]);
        const invite = items.find((i) => i.kind === "affiliation");
        pendingAffiliationTeam.set(
          email,
          invite?.kind === "affiliation" ? invite.teamId : null,
        );
      }
      current = pendingAffiliationTeam.get(email) ?? null;
    }
    const target = person ? { oid: person.oid } : email ? { key: email } : null;
    if (candidatesOf.length === 0) {
      if ((user?.teams?.length ?? 0) > 0 && current === null && target) {
        notPlaced.set(row.litellmUserId, {
          litellmUserId: row.litellmUserId,
          reason: "no-linked-team",
        });
      }
      continue;
    }
    if (!target) continue;
    const [only] = candidatesOf;
    if (candidatesOf.length === 1 && only !== undefined) {
      if (current === only) continue;
      if (current !== null) {
        memberships.push({
          litellmUserId: row.litellmUserId,
          teamId: only,
          outcome: "skip",
          reason: "other-team",
        });
        notPlaced.set(row.litellmUserId, {
          litellmUserId: row.litellmUserId,
          reason: "other-team",
        });
        continue;
      }
      memberships.push({
        litellmUserId: row.litellmUserId,
        teamId: only,
        outcome: person ? "add-member" : "add-pending-member",
        ...target,
      });
      continue;
    }
    if (current !== null && candidatesOf.includes(current)) continue;
    const reason = current === null ? "multiple-teams" : "other-team";
    memberships.push({
      litellmUserId: row.litellmUserId,
      teamId: candidatesOf[0] ?? "",
      outcome: "skip",
      reason,
    });
    notPlaced.set(row.litellmUserId, {
      litellmUserId: row.litellmUserId,
      reason,
    });
  }

  // Drift: reported, never acted on.
  const drift: SyncDriftRow[] = [];
  const present = new Set(users.map((u) => u.userId));
  for (const team of teams) {
    const ids = new Set(team.members.map((m) => m.userId));
    for (const p of directory.people) {
      if (p.affiliation?.teamId !== team.teamId) continue;
      const inTeam =
        (p.litellmUserId !== null && ids.has(p.litellmUserId)) ||
        team.members.some((m) => {
          const match = matchLiteLLMUser(
            { ...p, email: p.email ?? null, upn: p.upn ?? null },
            { userId: m.userId, email: m.email, ssoUserId: null },
            tenant,
          );
          return match.entraId || match.email;
        });
      if (!inTeam) {
        drift.push({
          kind: "not-in-litellm-team",
          oid: p.oid,
          teamId: team.teamId,
        });
      }
    }
  }
  if (!truncated) {
    for (const p of directory.people) {
      if (p.litellmUserId && !present.has(p.litellmUserId)) {
        drift.push({ kind: "not-in-litellm", oid: p.oid });
      }
    }
  }

  const userRows: SyncUserRow[] = rows.map((r) => ({
    ...r,
    email: userById.get(r.litellmUserId)?.email ?? "",
  }));
  const hashRows: HashRow[] = [
    ...rows,
    ...removals,
    ...memberships.map((m) => ({
      litellmUserId: m.litellmUserId,
      outcome: m.outcome,
      ...(m.reason ? { reason: m.reason } : {}),
      ...(m.oid ? { oid: m.oid } : {}),
      ...(m.key ? { key: m.key } : {}),
      teamId: m.teamId,
    })),
  ];
  const count = (outcome: PlanRow["outcome"]) =>
    rows.filter((r) => r.outcome === outcome).length;
  return {
    people,
    pendingByUser,
    plan: {
      planHash: planHash(hashRows),
      truncated,
      users: userRows,
      removals,
      memberships,
      drift,
      notPlaced: [...notPlaced.values()],
      notes,
      counts: {
        toLink: count("link-existing"),
        toPend: count("create-pending"),
        alreadyLinked: count("already-linked") + count("already-pending"),
        skipped: count("skip"),
        memberships: memberships.filter((m) => m.outcome !== "skip").length,
      },
    },
  };
}

// ---- apply ----------------------------------------------------------------

type Change =
  | { kind: "user"; row: PlanRow }
  | { kind: "removal"; row: SyncRemovalRow }
  | { kind: "membership"; row: SyncMembershipRow };

const refusal = (code: AccessErrorCode): string => code.toLowerCase();

async function applyChange(
  change: Change,
  built: BuiltPlan,
  runId: string,
  ctx: AuditContext,
): Promise<SyncResultRow> {
  const base = {
    litellmUserId: change.row.litellmUserId,
    outcome: change.row.outcome,
  };
  const done = (
    result: { ok: true } | { ok: false; code: AccessErrorCode },
  ): SyncResultRow =>
    result.ok
      ? { ...base, status: "applied" }
      : { ...base, status: "refused", reason: refusal(result.code) };

  if (change.kind === "removal") {
    const stored = built.pendingByUser.get(change.row.litellmUserId);
    if (!stored) return { ...base, status: "refused", reason: "not_found" };
    return done(
      await removePendingLiteLLMLink(
        { emailOrOid: stored.key, version: stored.version, runId },
        ctx,
      ),
    );
  }
  if (change.kind === "membership") {
    const m = change.row;
    if (m.outcome === "add-member" && m.oid) {
      return done(await addMember({ oid: m.oid, teamId: m.teamId }, ctx));
    }
    if (m.key) {
      return done(
        await createPendingItem(
          { kind: "affiliation", emailOrUpn: m.key, teamId: m.teamId },
          ctx,
        ),
      );
    }
    return { ...base, status: "refused", reason: "not_found" };
  }
  const planRow = change.row;
  if (planRow.outcome === "create-pending" && planRow.key) {
    return done(
      await createPendingLiteLLMLink(
        {
          emailOrOid: planRow.key,
          litellmUserId: planRow.litellmUserId,
          runId,
        },
        ctx,
      ),
    );
  }
  if (planRow.outcome === "link-existing" && planRow.oid) {
    const person = built.people.get(planRow.oid);
    const placeholder = built.pendingByUser.get(planRow.litellmUserId);
    return done(
      await writeLiteLLMUserLink(
        {
          oid: planRow.oid,
          version: person?.linkVersion ?? null,
          write: {
            kind: "set",
            litellmUserId: planRow.litellmUserId,
            mode: "sync",
            runId,
            ...(planRow.matchedKey ? { matchedKey: planRow.matchedKey } : {}),
          },
          ...(placeholder
            ? {
                pending: { key: placeholder.key, version: placeholder.version },
              }
            : {}),
        },
        ctx,
      ),
    );
  }
  return { ...base, status: "refused", reason: "not_found" };
}

function changesOf(plan: SyncPlan): Change[] {
  return [
    ...plan.removals
      .filter((r) => r.reason !== "removal-guard")
      .map((row): Change => ({ kind: "removal", row })),
    ...plan.users
      .filter(
        (r) => r.outcome === "link-existing" || r.outcome === "create-pending",
      )
      .map((row): Change => ({ kind: "user", row })),
    ...plan.memberships
      .filter((m) => m.outcome !== "skip")
      .map((row): Change => ({ kind: "membership", row })),
  ];
}

// The id of the run in this process that holds the lease, for the job's
// deadline and SIGTERM release (Platform - Scheduled job). Set only after the
// lease is acquired; a refused run or a preview never touches it.
let heldRunId: string | undefined;

export function currentRunId(): string | undefined {
  return heldRunId;
}

export async function runLiteLLMUserSync(input: RunInput): Promise<RunResult> {
  const { trigger, actor } = input;
  const callerOid = trigger === "manual" ? actor : null;
  if (input.mode === "preview") {
    const built = await buildPlan(trigger, callerOid);
    return { ok: true, value: { plan: built.plan } };
  }

  const runId = randomUUID();
  const ctx: AuditContext = {
    actor: trigger === "schedule" ? SYSTEM : actor,
    requestId: runId,
    now: new Date(),
    sequence: { next: 0 },
  };
  const skipRun = async (
    skipped: "disabled" | "locked",
  ): Promise<RunResult> => {
    await writeSyncSummary(ctx, runId, trigger, { skipped });
    return { ok: true, value: { runId, skipped } };
  };

  if (trigger === "schedule" && !(await syncEnabled())) {
    return skipRun("disabled");
  }
  const lease = await acquireUserSyncLease(runId, new Date());
  if (!lease) {
    return trigger === "schedule"
      ? skipRun("locked")
      : { ok: false, code: "SYNC_RUNNING" };
  }

  heldRunId = runId;
  try {
    const built = await buildPlan(trigger, callerOid);
    const { plan } = built;
    if (plan.truncated) return { ok: false, code: "PLAN_TRUNCATED" };
    if (trigger === "manual" && input.planHash !== plan.planHash) {
      return { ok: false, code: "PLAN_CHANGED" };
    }

    const all = changesOf(plan);
    const batch = all.slice(0, MAX_CHANGES);
    const users: SyncResultRow[] = [];
    const memberships: SyncResultRow[] = [];
    for (let i = 0; i < batch.length; i += BATCH) {
      if (!(await renewUserSyncLease(runId, new Date()))) {
        await writeSyncSummary(ctx, runId, trigger, { skipped: "lost-lease" });
        return { ok: false, code: "SYNC_RUNNING" };
      }
      for (const change of batch.slice(i, i + BATCH)) {
        const result = await applyChange(change, built, runId, ctx);
        (change.kind === "membership" ? memberships : users).push(result);
      }
    }
    const applied = [...users, ...memberships].filter(
      (r) => r.status === "applied",
    ).length;
    await writeSyncSummary(ctx, runId, trigger, {
      truncated: false,
      planHash: plan.planHash,
      counts: [
        `applied=${applied}`,
        `refused=${users.length + memberships.length - applied}`,
        `remaining=${all.length - batch.length}`,
        `skipped=${plan.counts.skipped}`,
      ],
    });
    return {
      ok: true,
      value: {
        plan,
        runId,
        applied,
        remaining: all.length - batch.length,
        unplaced: plan.notPlaced,
        notes: plan.notes,
        results: { users, memberships },
      },
    };
  } finally {
    if (heldRunId === runId) heldRunId = undefined;
    await releaseUserSyncLease(runId);
  }
}
