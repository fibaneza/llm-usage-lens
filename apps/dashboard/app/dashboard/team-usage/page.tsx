import { notFound } from "next/navigation";

import { auth } from "@/auth";
import { TeamUsageContent } from "@/components/manage/TeamUsageContent";
import { resolveScope } from "@/lib/auth/policy";
import { authorizationFor } from "@/lib/litellm/route-guard";
import { viewableTeams } from "@/lib/litellm/read-views";
import { managementAccessFor } from "@/lib/manage-access";
import { scopeLabelFor } from "@/lib/scope-labels";

// Server-side gate (Access Control - MI-D7, T-MI4): the teamUsage flag (every
// global reader, and a caller with a live admin scope for its teams); everyone
// else, and a team outside the caller's list, get the standard not-found page.
export default async function TeamUsagePage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string }>;
}) {
  const { team } = await searchParams;
  const session = await auth();
  const access = await managementAccessFor(session);
  if (!access.teamUsage || !session) notFound();

  const { teams } = await viewableTeams(session);
  const list = teams.map(({ teamId, teamName, linked }) => ({
    teamId,
    teamName,
    linked,
  }));
  if (team !== undefined && !list.some((t) => t.teamId === team)) notFound();

  const input = await authorizationFor(session);
  const scope = resolveScope({
    ...input,
    session,
    adminScopes: input.adminScopes ?? [],
  });

  return (
    <TeamUsageContent
      teams={list}
      includeMemberSum={access.global}
      scopeLabel={access.global ? null : scopeLabelFor(scope)}
    />
  );
}
