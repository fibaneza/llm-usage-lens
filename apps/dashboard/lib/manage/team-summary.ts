import "server-only";

import { trace } from "@opentelemetry/api";

import { isAdminScopeSuspended, runBounded } from "@llm-usage-lens/shared";
import type { AdminScope } from "@llm-usage-lens/shared";

import type { TeamSummaryPanelProps } from "@/components/manage/TeamSummaryPanel";
import { cursorSecret } from "@/lib/api/access-route";
import type { TeamDirectoryEntry } from "@/lib/api/team-directory";
import { listScopeAdmins } from "@/lib/data/access/admin-scopes";
import { getAppTeam } from "@/lib/data/access/app-teams";
import {
  getIdentityRecord,
  listAllTeamMemberOids,
} from "@/lib/data/access/team-member-lookup";
import { listTeamResets } from "@/lib/data/budget-reset-counts";
import { getTeamLink } from "@/lib/data/litellm/team-links";
import type { DateRange } from "@/lib/date-range";
import { LiteLLMError, isLiteLLMConfigured } from "@/lib/litellm/client";
import { listProxyTeams } from "@/lib/litellm/operations";

// Source: Design System - Team page, round 3 (unit TP1), Summary (T-TP1,
// ruling Q-B1: the LiteLLM alias and id only for a global role; a lead sees
// Linked or Not linked). Built per request from existing reads; nothing here
// is cached (Rule 60.10).
export type TeamSummary = Omit<TeamSummaryPanelProps, "canEdit">;

const IDENTITY_READ_CONCURRENCY = 5;

async function leadNamesOf(teamId: string): Promise<string[]> {
  const scopes: AdminScope[] = [];
  let cursor: string | undefined;
  do {
    const page = await listScopeAdmins(
      { scopeType: "team", scopeId: teamId },
      { cursorSecret: cursorSecret(), cursor },
    );
    if (!page.ok) throw new Error(`team admin listing failed: ${page.code}`);
    scopes.push(...page.value.items);
    cursor = page.value.cursor;
  } while (cursor);

  const names: string[] = [];
  await runBounded(
    [...new Set(scopes.map((s) => s.oid))],
    IDENTITY_READ_CONCURRENCY,
    async (oid) => {
      const identity = await getIdentityRecord(oid);
      if (!identity) return;
      const held = scopes.filter((s) => s.oid === oid);
      if (held.every((s) => isAdminScopeSuspended(s, identity))) return;
      names.push(
        identity.displayName ?? identity.email ?? identity.upn ?? identity.oid,
      );
    },
  );
  return names.sort((a, b) => a.localeCompare(b));
}

async function litellmOf(
  teamId: string,
  global: boolean,
): Promise<TeamSummary["litellm"]> {
  const link = await getTeamLink(teamId);
  if (!link) return { linked: false };
  if (!global) return { linked: true };
  if (!(await isLiteLLMConfigured())) {
    return { linked: true, teamId: link.litellmTeamId };
  }
  try {
    const alias = (await listProxyTeams()).find(
      (t) => t.team_id === link.litellmTeamId,
    )?.team_alias;
    return {
      linked: true,
      teamId: link.litellmTeamId,
      ...(alias ? { alias } : {}),
    };
  } catch (error) {
    if (error instanceof LiteLLMError) {
      trace.getActiveSpan()?.recordException(error);
      return { linked: true, teamId: link.litellmTeamId };
    }
    throw error;
  }
}

export async function loadTeamSummary(
  entry: TeamDirectoryEntry,
  options: { global: boolean; range?: DateRange },
): Promise<TeamSummary> {
  const range = options.range;
  const [leadNames, members, litellm, resets, appTeam] = await Promise.all([
    leadNamesOf(entry.teamId),
    listAllTeamMemberOids(entry.teamId),
    litellmOf(entry.teamId, options.global),
    range
      ? listTeamResets(entry.teamId, range.dateFrom, range.dateTo)
      : Promise.resolve([]),
    entry.hasAwsAccount ? Promise.resolve(null) : getAppTeam(entry.teamId),
  ]);

  return {
    name: entry.teamName,
    departmentName: entry.departmentName,
    kind: entry.hasAwsAccount ? "registry" : "created",
    leadNames,
    memberCount: members.length,
    litellm,
    budgetResetsInRange: resets.length,
    ...(appTeam
      ? {
          editTarget: {
            teamId: appTeam.teamId,
            name: appTeam.name,
            departmentId: appTeam.departmentId,
            version: appTeam.version,
          },
        }
      : {}),
  };
}
