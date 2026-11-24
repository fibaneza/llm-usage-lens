import {
  LiteLLMMembersResponseSchema,
  runBounded,
} from "@llm-usage-lens/shared";
import type { IdentityRecord } from "@llm-usage-lens/shared";
import type { Session } from "next-auth";
import { z } from "zod";

import { IdParamSchema } from "@/lib/api/id-param";
import {
  NOT_FOUND_MESSAGE,
  NotFoundError,
  jsonData,
  parseInput,
  withRoute,
} from "@/lib/api/respond";
import { loadManager } from "@/lib/api/matrix-route";
import { decideWrite } from "@/lib/auth/write-policy";
import {
  getIdentityRecord,
  listAllTeamMemberOids,
} from "@/lib/data/access/team-member-lookup";
import { placeableIdentity, readSsoIds } from "@/lib/api/member-placement";
import type { SsoIds } from "@/lib/api/member-placement";
import { buildTeamDirectory } from "@/lib/api/team-directory";
import { listIdentitiesBounded } from "@/lib/data/access/identities";
import { listPendingFor } from "@/lib/data/access/pending";
import { getAllAccounts } from "@/lib/data/account-meta";
import { listAppTeams } from "@/lib/data/access/app-teams";
import { mapTeamMembers } from "@/lib/data/litellm/team-members";
import {
  NON_PRIVILEGED_ROLES,
  PrivilegedTargetError,
  badRequest,
  memberWriteRoute,
  snapshot,
} from "@/lib/litellm/member-write";
import {
  Duration,
  addTeamMember,
  findUserByEmail,
  getTeam,
  getUser,
} from "@/lib/litellm/operations";
import {
  liteLLMResponse,
  reduceMembers,
  resolveLiteLLMTeam,
} from "@/lib/litellm/read-views";
import { openModeRefusal } from "@/lib/litellm/route-guard";
import { PositiveBudget } from "@/lib/litellm/team-write";

// Source: docs/specs/2026-11-10-litellm.md — "API routes" (/api/litellm/teams/
// [teamId]/members GET in scope), "Roles and rights" (a Lead sees members'
// spend, budgets and limits), "Reads" (getTeam; team_memberships are loose
// rows reduced to allowlisted fields), "Identity mapping and members".

export const dynamic = "force-dynamic";

export const GET = withRoute(async (_request, { params }, session) => {
  const refused = openModeRefusal();
  if (refused) return refused;
  const teamId = parseInput((await params).teamId, IdParamSchema);
  const team = await resolveLiteLLMTeam(session, teamId);
  const { litellmTeamId } = team;
  if (litellmTeamId === null) return jsonData({ connected: false, items: [] });
  return liteLLMResponse(async () => {
    const info = await getTeam({ litellmTeamId });
    const emails = new Map(
      (info.team_info.members_with_roles ?? []).flatMap((m) =>
        m.user_id && m.user_email ? [[m.user_id, m.user_email] as const] : [],
      ),
    );
    const dashboardMembers = await mapTeamMembers(teamId);
    const writer = await mayWriteMembers(session, teamId);
    const signedIn = writer ? await signedInPeople() : null;
    let ssoRead: Promise<SsoIds | null> | undefined;
    const readIds = () => (ssoRead ??= readSsoIds(litellmTeamId));
    const items = await Promise.all(
      reduceMembers(info.team_memberships, emails).map(async (m) => {
        const { spend, maxBudget, budgetDuration, ...identity } = m;
        const person =
          dashboardMembers.get(m.userId.toLowerCase()) ??
          dashboardMembers.get(m.email.toLowerCase());
        const email = m.email.toLowerCase();
        const placeable =
          signedIn && !person
            ? await placeableIdentity(
                signedIn.people,
                { userId: m.userId, email },
                readIds,
              )
            : null;
        return {
          ...identity,
          ...(team.perUserCostHidden
            ? {}
            : { spend, maxBudget, budgetDuration }),
          ...(person ? { oid: person.oid, name: person.name } : {}),
          ...(signedIn
            ? {
                state:
                  person || placeable
                    ? ("signed-in" as const)
                    : (await hasMemberInvite(email, teamId))
                      ? ("invited" as const)
                      : ("unknown" as const),
                ...(placeable
                  ? {
                      identityOid: placeable.oid,
                      identityName: placeable.displayName ?? placeable.email,
                      ...(placeable.email
                        ? { identityEmail: placeable.email }
                        : {}),
                    }
                  : {}),
              }
            : {}),
        };
      }),
    );
    const candidates = writer ? await addCandidates(teamId, items) : null;
    return jsonData(
      LiteLLMMembersResponseSchema.parse({
        connected: true,
        litellmTeamId,
        items,
        ...(candidates ? { candidates } : {}),
        ...(signedIn ? { truncated: signedIn.truncated } : {}),
      }),
    );
  });
});

// Source: docs/specs/2026-11-10-litellm.md - "Team configuration page (L4)",
// LD23: dashboard members of the team not yet in the LiteLLM team (matched by
// email), identities only, for callers who may write members.
async function mayWriteMembers(
  session: Session,
  teamId: string,
): Promise<boolean> {
  const actor = await loadManager(session);
  if (!actor) return false;
  const meta = buildTeamDirectory(
    ...(await Promise.all([getAllAccounts(), listAppTeams()])),
  ).find((a) => a.teamId === teamId);
  return (
    meta !== undefined &&
    decideWrite(actor, {
      operation: "member",
      team: { teamId, departmentId: meta.departmentId },
    }) === "allow"
  );
}

// Source: Access Control - "Same person" and "Placing a person by hand": the
// signed-in people a row may be matched to, read per request (Rule 60.10) for
// callers who may write members only (T-IV5). The list items lack the UPN and
// the tenant, so the full records are read, a few at a time.
const RECORD_CONCURRENCY = 10;

async function signedInPeople(): Promise<{
  people: IdentityRecord[];
  truncated: boolean;
}> {
  const { items, truncated } = await listIdentitiesBounded();
  const people: IdentityRecord[] = [];
  await runBounded(items, RECORD_CONCURRENCY, async (item) => {
    const record = await getIdentityRecord(item.oid);
    if (record) people.push(record);
  });
  return { people, truncated };
}

async function hasMemberInvite(
  email: string,
  teamId: string,
): Promise<boolean> {
  return (await listPendingFor([email])).some(
    (p) => p.kind === "affiliation" && p.teamId === teamId,
  );
}

async function addCandidates(
  teamId: string,
  items: ReadonlyArray<{ email: string }>,
): Promise<Array<{
  oid: string;
  name: string;
  email: string;
  state: "signed-in";
}> | null> {
  const inLiteLLM = new Set(items.map((m) => m.email.toLowerCase()));
  const oids = await listAllTeamMemberOids(teamId);
  const people = await Promise.all(
    oids.map(async (oid) => {
      const identity = await getIdentityRecord(oid);
      const email = identity?.email?.trim().toLowerCase();
      if (!identity || !email || inLiteLLM.has(email)) return [];
      return [
        {
          oid,
          name: identity.displayName ?? email,
          email,
          state: "signed-in" as const,
        },
      ];
    }),
  );
  return people.flat();
}

// ---- POST: add a dashboard member to the linked LiteLLM team ----------------

// Source: docs/specs/2026-11-10-litellm.md - "Writes" (addTeamMember: Lead
// (existing dashboard members only) and Admin; user and member bodies),
// "Identity mapping and members" (OSS creates a missing user, Enterprise never
// does: 409), "Budgets and limits" (member budget <= team max_budget),
// "Allowlist" (privileged targets: 409 PRIVILEGED_TARGET), LT13, LT16, LT18.
const AddBodySchema = z.strictObject({
  oid: IdParamSchema,
  maxBudgetInTeam: PositiveBudget.optional(),
  budgetDuration: Duration.optional(),
});

export const POST = memberWriteRoute(
  {
    action: "litellm.member.add",
    pattern: "/api/litellm/teams/[teamId]/members",
    toggle: "addTeamMember",
    status: 201,
    target: "dashboard-member",
    oidFrom: (body) => body.oid,
    body: AddBodySchema,
  },
  async ({ actor, litellmTeamId, oid, body, teamInfo }) => {
    const ceiling = teamInfo.team_info.max_budget;
    if (
      body.maxBudgetInTeam !== undefined &&
      ceiling !== null &&
      ceiling !== undefined &&
      body.maxBudgetInTeam > ceiling
    ) {
      throw badRequest("The member budget is above the team's budget");
    }
    const email = (await getIdentityRecord(oid))?.email?.trim().toLowerCase();
    if (!email) throw new NotFoundError(NOT_FOUND_MESSAGE);

    const { users } = await findUserByEmail({ email });
    const existing = users.find((u) => u.user_email?.toLowerCase() === email);
    if (existing) {
      const info = await getUser({ litellmUserId: existing.user_id });
      const role = info.user_info?.user_role;
      if (!role || !NON_PRIVILEGED_ROLES.includes(role)) {
        throw new PrivilegedTargetError(existing.user_id);
      }
    }
    const { litellmUserId } = await addTeamMember(
      {
        litellmTeamId,
        email,
        ...(body.maxBudgetInTeam === undefined
          ? {}
          : { maxBudgetInTeam: body.maxBudgetInTeam }),
        ...(body.budgetDuration === undefined
          ? {}
          : { budgetDuration: body.budgetDuration }),
      },
      { actor },
    );
    return {
      data: { oid, litellmUserId },
      targetId: litellmUserId,
      after: snapshot({
        litellmUserId,
        maxBudgetInTeam: body.maxBudgetInTeam,
      }),
    };
  },
);
