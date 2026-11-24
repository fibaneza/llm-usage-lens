import {
  CreateLiteLLMUserBodySchema,
  CreateLiteLLMUserResultSchema,
  LiteLLMUserSearchResponseSchema,
  USER_LINKS_PAGE_SIZE,
  UsersListResponseSchema,
} from "@llm-usage-lens/shared";
import type { UsersListRow } from "@llm-usage-lens/shared";
import { z } from "zod";

import { auditContext } from "@/lib/api/access-route";
import { IdParamSchema } from "@/lib/api/id-param";
import { readLinkTarget } from "@/lib/api/litellm-user-link";
import {
  NOT_FOUND_MESSAGE,
  jsonData,
  jsonError,
  parseJsonBody,
  parseSearchParams,
  recordDeniedWrite,
  withRoute,
} from "@/lib/api/respond";
import {
  identityExists,
  ownEmail,
  personNamesOf,
} from "@/lib/data/access/identities";
import {
  getIdentityLink,
  getLiteLLMUserOwner,
  recordLiteLLMUserCreated,
  writeLiteLLMUserLink,
} from "@/lib/data/access/identity-links";
import { listAllTeamMemberOids } from "@/lib/data/access/team-member-lookup";
import {
  createUser,
  findUserByEmail,
  getTeam,
  searchUsers,
} from "@/lib/litellm/operations";
import {
  enabledOperations,
  liteLLMResponse,
  reduceMembers,
  requireEnabled,
  resolveLiteLLMTeam,
  teamAccess,
} from "@/lib/litellm/read-views";
import {
  openModeRefusal,
  permitAdminOrOrgAdmin,
} from "@/lib/litellm/route-guard";
import { MemberSumTooManyMembers } from "@/lib/litellm/member-sum-error";
import { runBoundedSettled } from "@/lib/litellm/run-settled";
import { notFoundResponse } from "@/lib/api/matrix-route";

// Source: docs/specs/2026-11-10-litellm.md - "Reads" (searchUsers: `search`
// optional from M3, page_size <= 25; a Lead's search sends team=<linked team>
// once per team in scope), "Views as Management routes" (D16a: all users, or
// the members of one team; LD34 call budget, at most 26 calls a page), "Views
// by role (L3b)" (Scope), "API routes", LD22, LD23 (cap), LT21, LT-MI1, LT-MI2,
// "Writes" (`createUser`), Access Control - "LiteLLM user links". Rows are
// filtered to the caller's teams after the call, so a proxy that ignores
// team= cannot widen the result.

export const dynamic = "force-dynamic";

const LOOKUP_CONCURRENCY = 5;
const CREATE_PATTERN = "/api/litellm/users";

const UsersQuerySchema = z.object({
  q: z.string().trim().min(2).max(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(25).optional(),
  team: IdParamSchema.optional(),
  // Unit SRT1 (D-SR1): our enums, mapped server-side; never passed on as typed.
  sort: z.enum(["email", "spend"]).optional(),
  dir: z.enum(["asc", "desc"]).optional(),
});

type SortKey = "email" | "spend";
const SORT_BY = { email: "user_email", spend: "spend" } as const;

// A row without the value is last in both directions (SRT1, D-SR1).
function compareBy<T>(
  value: (row: T) => string | number | undefined,
  dir: "asc" | "desc",
) {
  return (a: T, b: T): number => {
    const x = value(a);
    const y = value(b);
    if (x === undefined || y === undefined) {
      return x === y ? 0 : x === undefined ? 1 : -1;
    }
    const c =
      typeof x === "number" && typeof y === "number"
        ? x - y
        : String(x).localeCompare(String(y), "en");
    return dir === "asc" ? c : -c;
  };
}

type Teams = Array<{ teamId: string; teamName: string }>;

export const GET = withRoute(async (request, _ctx, session) => {
  const refused = openModeRefusal();
  if (refused) return refused;
  const access = await teamAccess(session);
  const query = parseSearchParams(request, UsersQuerySchema);
  const listMode = query.q === undefined || query.team !== undefined;
  // The list and the team filter are for the global readers; a Lead or a user
  // gets the missing-page 404 (LT-MI2).
  if (listMode && !access.orgWide) {
    return jsonError(404, "NOT_FOUND", NOT_FOUND_MESSAGE);
  }
  if (!access.orgWide && !access.lead) {
    return jsonError(403, "FORBIDDEN", "Insufficient permission");
  }
  // LD23: the order of a spend sort would reveal hidden spend.
  if (query.sort === "spend" && access.perUserCostHidden) {
    return jsonError(400, "BAD_REQUEST", "Spend is not available to sort by");
  }
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? USER_LINKS_PAGE_SIZE;
  const hidden = access.perUserCostHidden;
  const sort = query.sort
    ? { key: query.sort, dir: query.dir ?? ("asc" as const) }
    : undefined;
  const upstreamSort = sort
    ? { sortBy: SORT_BY[sort.key], sortOrder: sort.dir }
    : {};
  const mayLink = await permitAdminOrOrgAdmin(request, session);
  // Read per request, never cached (Rule 60.10).
  const callerLitellmUserId =
    (await getIdentityLink(session.user.oid))?.litellmUserId ?? null;
  const byLiteLLMId = new Map(access.linked.map((t) => [t.litellmTeamId, t]));
  const teamsOf = (ids: readonly string[] | null | undefined): Teams =>
    (ids ?? []).flatMap((id) => {
      const team = byLiteLLMId.get(id);
      return team ? [{ teamId: team.teamId, teamName: team.teamName }] : [];
    });

  return liteLLMResponse(async () => {
    const enabled = await enabledOperations();

    if (access.orgWide && query.team !== undefined) {
      return teamMembers({
        teamId: query.team,
        page,
        pageSize,
        hidden,
        enabled,
        teamsOf,
        session,
        mayLink,
        sort,
        ...(query.q !== undefined ? { q: query.q } : {}),
      });
    }

    requireEnabled(enabled, ["searchUsers"]);
    if (access.orgWide && query.q === undefined) {
      const result = await searchUsers({
        ...(query.q !== undefined ? { search: query.q } : {}),
        page,
        pageSize,
        ...upstreamSort,
      });
      const rows = await Promise.all(
        result.users.map(async (u): Promise<UsersListRow> => {
          const oid = await getLiteLLMUserOwner(u.user_id);
          const [names, link] = oid
            ? await Promise.all([personNamesOf([oid]), getIdentityLink(oid)])
            : [null, null];
          const person = oid ? names?.get(oid) : undefined;
          return {
            key: u.user_id,
            linkState: oid ? "linked" : "unlinked",
            appUser: oid
              ? {
                  oid,
                  displayName: person?.displayName ?? null,
                  email: person?.email ?? null,
                  version: link?.version ?? 0,
                }
              : null,
            litellmUser: {
              userId: u.user_id,
              email: u.user_email ?? u.user_id,
              teams: teamsOf(u.teams),
              ...(hidden
                ? {}
                : { spend: u.spend ?? 0, maxBudget: u.max_budget ?? null }),
            },
          };
        }),
      );
      const totalPages = result.total_pages ?? null;
      return jsonData(
        UsersListResponseSchema.parse({
          users: rows,
          page,
          pageSize,
          hasMore:
            result.users.length >= pageSize &&
            (totalPages === null || page < totalPages),
          enabledOperations: enabled,
          mayLink,
        }),
      );
    }

    const scopes: Array<string | undefined> = access.orgWide
      ? [undefined]
      : access.linked.map((t) => t.litellmTeamId);
    const results = await Promise.all(
      scopes.map((litellmTeamId) =>
        searchUsers({
          search: query.q,
          page,
          pageSize,
          ...upstreamSort,
          ...(litellmTeamId ? { litellmTeamId } : {}),
        }),
      ),
    );
    const merged = new Map<
      string,
      {
        userId: string;
        email: string;
        spend: number;
        maxBudget: number | null;
        teams: Map<string, { teamId: string; teamName: string }>;
      }
    >();
    for (const row of results.flatMap((r) => r.users)) {
      const teams = teamsOf(row.teams);
      if (!access.orgWide && teams.length === 0) continue;
      const entry = merged.get(row.user_id) ?? {
        userId: row.user_id,
        email: row.user_email ?? row.user_id,
        spend: row.spend ?? 0,
        maxBudget: row.max_budget ?? null,
        teams: new Map(),
      };
      for (const t of teams) entry.teams.set(t.teamId, t);
      merged.set(row.user_id, entry);
    }
    // A Lead's per-team pages merge into one list: sorted by email and cut to
    // pageSize so a page never exceeds 25 rows (Reads - searchUsers).
    const rows = [...merged.values()];
    const ordered = access.orgWide
      ? rows
      : rows
          .sort(
            compareBy(
              sort?.key === "spend"
                ? (r: (typeof rows)[number]) => r.spend
                : (r: (typeof rows)[number]) => r.email,
              sort?.dir ?? "asc",
            ),
          )
          .slice(0, pageSize);
    return jsonData(
      LiteLLMUserSearchResponseSchema.parse({
        users: ordered.map(({ spend, maxBudget, ...identity }) => ({
          ...identity,
          teams: [...identity.teams.values()],
          ...(hidden ? {} : { spend, maxBudget }),
        })),
        page,
        pageSize,
        enabledOperations: enabled,
        mayLink,
        callerLitellmUserId,
      }),
    );
  });
});

// "Members of one team" (D16a): the app team's members, each with the LiteLLM
// user from the stored link, else the email lookup ("not in LiteLLM" is a
// state, never $0); for a linked team the LiteLLM team's own members follow,
// so an orphaned LiteLLM member is visible. At most one lookup per member of
// the page and one getTeam: 26 calls (LD34). A team above 200 members is
// refused with 422 and no LiteLLM call.
async function teamMembers(args: {
  teamId: string;
  page: number;
  pageSize: number;
  hidden: boolean;
  enabled: Awaited<ReturnType<typeof enabledOperations>>;
  teamsOf: (ids: readonly string[] | null | undefined) => Teams;
  session: Parameters<typeof resolveLiteLLMTeam>[0];
  mayLink: boolean;
  sort: { key: SortKey; dir: "asc" | "desc" } | undefined;
  q?: string;
}): Promise<Response> {
  const {
    teamId,
    page,
    pageSize,
    hidden,
    enabled,
    teamsOf,
    session,
    mayLink,
    sort,
  } = args;
  const team = await resolveLiteLLMTeam(session, teamId);
  const oids = await listAllTeamMemberOids(teamId);
  if (oids.length > 200) throw new MemberSumTooManyMembers(oids.length);
  requireEnabled(enabled, [
    "findUserByEmail",
    ...(team.litellmTeamId ? (["getTeam"] as const) : []),
  ]);

  const names = await personNamesOf(oids);
  const label = (oid: string) =>
    (names.get(oid)?.displayName ?? names.get(oid)?.email ?? oid).toLowerCase();
  const needle = args.q?.toLowerCase();
  const matches = (oid: string) =>
    needle === undefined ||
    [names.get(oid)?.displayName, names.get(oid)?.email].some((v) =>
      v?.toLowerCase().includes(needle),
    );
  const members = [...new Set(oids)]
    .filter(matches)
    .sort((a, b) => label(a).localeCompare(label(b), "en"));

  type LiteLLMMember = {
    userId: string;
    email: string;
    spend?: number;
    maxBudget?: number | null;
  };
  const inTeam = new Map<string, LiteLLMMember>();
  if (team.litellmTeamId) {
    const info = await getTeam({ litellmTeamId: team.litellmTeamId });
    const emails = new Map(
      (info.team_info.members_with_roles ?? []).flatMap((m) =>
        m.user_id && m.user_email ? [[m.user_id, m.user_email] as const] : [],
      ),
    );
    for (const m of reduceMembers(info.team_memberships, emails)) {
      inTeam.set(m.userId, {
        userId: m.userId,
        email: m.email,
        ...(hidden ? {} : { spend: m.spend, maxBudget: m.maxBudget }),
      });
    }
  }

  // Orphans: LiteLLM team members no app member claims or shares an email with.
  const memberEmails = new Set(
    members.flatMap((oid) => {
      const email = names.get(oid)?.email?.trim().toLowerCase();
      return email ? [email] : [];
    }),
  );
  const orphans: LiteLLMMember[] = [];
  for (const m of inTeam.values()) {
    if (memberEmails.has(m.email.toLowerCase())) continue;
    if (await getLiteLLMUserOwner(m.userId)) continue;
    orphans.push(m);
  }
  if (needle !== undefined) {
    for (let i = orphans.length - 1; i >= 0; i--) {
      if (!orphans[i]?.email.toLowerCase().includes(needle)) {
        orphans.splice(i, 1);
      }
    }
  }
  orphans.sort((a, b) => a.email.localeCompare(b.email, "en"));

  const total = members.length + orphans.length;
  const start = (page - 1) * pageSize;
  const slice = [
    ...members.map((oid) => ({ kind: "member" as const, oid })),
    ...orphans.map((o) => ({ kind: "orphan" as const, user: o })),
  ].slice(start, start + pageSize);

  const rows = new Map<number, UsersListRow>();
  await runBoundedSettled(
    slice.map((entry, index) => ({ entry, index })),
    LOOKUP_CONCURRENCY,
    async ({ entry, index }, stopped) => {
      if (stopped()) return;
      if (entry.kind === "orphan") {
        rows.set(index, {
          key: entry.user.userId,
          linkState: "unlinked",
          appUser: null,
          litellmUser: {
            ...entry.user,
            teams: teamsOf(team.litellmTeamId ? [team.litellmTeamId] : []),
          },
        });
        return;
      }
      const { oid } = entry;
      const person = names.get(oid);
      const link = await getIdentityLink(oid);
      const appUser = {
        oid,
        displayName: person?.displayName ?? null,
        email: person?.email ?? null,
        version: link?.version ?? 0,
      };
      const email = person?.email?.trim().toLowerCase();
      let litellmUserId = link?.litellmUserId;
      let linkState: UsersListRow["linkState"] = litellmUserId
        ? "linked"
        : "none";
      let found: { user_id: string; user_email?: string | null } | undefined;
      if (!litellmUserId && email && z.email().safeParse(email).success) {
        const { users } = await findUserByEmail({ email });
        found = users.find((u) => u.user_email?.toLowerCase() === email);
        if (found) {
          litellmUserId = found.user_id;
          linkState = "match";
        }
      }
      const known = litellmUserId ? inTeam.get(litellmUserId) : undefined;
      rows.set(index, {
        key: oid,
        linkState,
        appUser,
        litellmUser: litellmUserId
          ? {
              userId: litellmUserId,
              email:
                known?.email ?? found?.user_email ?? email ?? litellmUserId,
              teams: teamsOf(
                known && team.litellmTeamId ? [team.litellmTeamId] : [],
              ),
              ...(known?.spend !== undefined
                ? { spend: known.spend, maxBudget: known.maxBudget ?? null }
                : {}),
            }
          : null,
      });
    },
  );

  const pageRows = slice
    .map((_, i) => rows.get(i))
    .filter((r) => r !== undefined);
  // The rows this page returns sort in memory (SRT1, D-SR1).
  if (sort) {
    pageRows.sort(
      compareBy(
        (r: UsersListRow) =>
          sort.key === "spend" ? r.litellmUser?.spend : r.litellmUser?.email,
        sort.dir,
      ),
    );
  }

  return jsonData(
    UsersListResponseSchema.parse({
      users: pageRows,
      page,
      pageSize,
      hasMore: start + pageSize < total,
      total,
      enabledOperations: enabled,
      mayLink,
    }),
  );
}

// ---- POST: create a LiteLLM user for an app identity and link it ------------

export const POST = withRoute(
  async (request, _ctx, session) => {
    const refused = openModeRefusal();
    if (refused) return refused;
    const body = await parseJsonBody(request, CreateLiteLLMUserBodySchema);
    // Never on oneself: the oid is in the body, so this 403 follows parsing
    // (Access Control - LiteLLM user links; the route's own test covers it).
    if (body.oid === session.user.oid) {
      await recordDeniedWrite(request, session.user.oid, {
        action: "litellm.user.create",
        pattern: CREATE_PATTERN,
      });
      return jsonError(403, "FORBIDDEN", "Insufficient permission");
    }
    if (!(await identityExists(body.oid))) return notFoundResponse();
    const email = await ownEmail(body.oid);
    if (!email) {
      return jsonError(409, "CONFLICT", "The identity has no verified email");
    }
    const existing = await getIdentityLink(body.oid);
    if (existing?.litellmUserId) {
      return jsonError(409, "CONFLICT", "The identity is already linked");
    }

    return liteLLMResponse(async () => {
      const actor = {
        oid: session.user.oid,
        email: session.user.email ?? null,
      };
      const created = await createUser({ email }, { actor });
      const ctx = auditContext(session);
      if (created.created) {
        await recordLiteLLMUserCreated(created.litellmUserId, ctx);
      } else {
        // A retry found the user: it must not be a privileged one.
        const target = await readLinkTarget(
          request,
          session,
          created.litellmUserId,
          "identity.litellm-link.set",
          CREATE_PATTERN,
        );
        if (!target.ok) return target.response;
      }
      const linked = await writeLiteLLMUserLink(
        {
          oid: body.oid,
          version: existing ? existing.version : null,
          write: {
            kind: "set",
            litellmUserId: created.litellmUserId,
            mode: "match",
          },
        },
        ctx,
      );
      if (!linked.ok) {
        return jsonError(
          409,
          "CONFLICT",
          "The LiteLLM user is already linked or the link changed",
        );
      }
      return jsonData(
        CreateLiteLLMUserResultSchema.parse({
          oid: body.oid,
          litellmUserId: created.litellmUserId,
          created: created.created,
          version: linked.value.version,
        }),
        { status: 201 },
      );
    });
  },
  {
    permit: permitAdminOrOrgAdmin,
    denied: { action: "litellm.user.create", pattern: CREATE_PATTERN },
  },
);
