"use client";

import { OrgUnitsSchema } from "@llm-usage-lens/shared";
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";

import {
  TEAM_LINKS_KEY,
  TeamLinksSchema,
} from "@/components/settings/litellm-panel/keys";
import { PanelSkeleton } from "@/components/settings/litellm-panel/PanelSkeleton";
import { SpendSourceTable } from "@/components/settings/litellm-panel/SpendSourceTable";
import {
  TeamLinkForm,
  type AppTeamChoices,
  type LiteLLMTeamList,
} from "@/components/settings/litellm-panel/TeamLinkForm";
import { TeamLinkNewTeamForm } from "@/components/settings/litellm-panel/TeamLinkNewTeamForm";
import { TeamLinkRow } from "@/components/settings/litellm-panel/TeamLinkRow";
import { Input } from "@/components/ui/input";
import { fetchApi } from "@/lib/query/fetch-api";

// Moved from Settings to Management -> LiteLLM -> LiteLLM teams (D3, 2026-11-17).
// `canCreateTeam` is Admin only (LD24); `canEdit` is Admin and org-admin.
export function LiteLLMTeamLinksSection({
  canEdit,
  canCreateTeam = false,
}: {
  canEdit: boolean;
  canCreateTeam?: boolean;
}) {
  const searchId = useId();
  const [term, setTerm] = useState("");
  const query = useQuery({
    queryKey: TEAM_LINKS_KEY,
    queryFn: () => fetchApi("/api/litellm/team-links", TeamLinksSchema),
  });

  const orgUnits = useQuery({
    queryKey: ["access", "org-units"],
    queryFn: () => fetchApi("/api/access/org-units", OrgUnitsSchema),
    enabled: canEdit || canCreateTeam,
  });

  if (query.isError) {
    return (
      <p role="alert" className="text-destructive text-sm">
        {query.error.message}
      </p>
    );
  }
  if (query.data === undefined) return <PanelSkeleton />;

  const appTeams: AppTeamChoices = orgUnits.data
    ? { state: "ready", teams: orgUnits.data.teams }
    : { state: "unavailable" };
  const litellmTeams: LiteLLMTeamList =
    query.data.litellmTeams !== undefined
      ? { state: "ready", teams: query.data.litellmTeams }
      : query.data.configured === false
        ? { state: "not-configured" }
        : { state: "unavailable" };
  const needle = term.trim().toLowerCase();
  const items = query.data.items.filter(
    (link) =>
      link.teamId.toLowerCase().includes(needle) ||
      link.litellmTeamId.toLowerCase().includes(needle),
  );
  return (
    <div className="flex max-w-[72ch] flex-col gap-3">
      {query.data.items.length === 0 ? (
        <div role="status" className="text-muted-foreground text-sm">
          <p>No LiteLLM team is linked yet.</p>
          <p>
            {canEdit
              ? "Linking a dashboard team to a LiteLLM team shows that team's LiteLLM spend, budget and members in the dashboard. The form below links one."
              : "An Admin or org-admin links teams."}
          </p>
        </div>
      ) : null}
      <label htmlFor={searchId} className="text-sm font-medium">
        Search teams
      </label>
      <Input
        id={searchId}
        type="search"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
      />
      {items.length === 0 ? (
        query.data.items.length === 0 ? null : (
          <p className="text-muted-foreground text-sm">No matching teams</p>
        )
      ) : (
        <ul className="divide-border divide-y">
          {items.map((link) => (
            <TeamLinkRow key={link.teamId} link={link} canEdit={canEdit} />
          ))}
        </ul>
      )}
      <SpendSourceTable appTeams={query.data.appTeams} />
      {canEdit && orgUnits.isPending ? <PanelSkeleton /> : null}
      {canEdit && !orgUnits.isPending ? (
        <TeamLinkForm
          links={query.data.items}
          appTeams={appTeams}
          litellmTeams={litellmTeams}
        />
      ) : null}
      {canCreateTeam && !orgUnits.isPending ? (
        <TeamLinkNewTeamForm links={query.data.items} appTeams={appTeams} />
      ) : null}
    </div>
  );
}
