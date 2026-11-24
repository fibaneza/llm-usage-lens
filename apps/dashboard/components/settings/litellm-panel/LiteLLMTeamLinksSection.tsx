"use client";

import { OrgUnitsSchema } from "@llm-usage-lens/shared";
import { useQuery } from "@tanstack/react-query";
import { useQueryStates } from "nuqs";
import { useId, useState } from "react";

import {
  TEAM_LINKS_KEY,
  TeamLinksSchema,
} from "@/components/settings/litellm-panel/keys";
import { LiteLLMTeamMembersPanel } from "@/components/settings/litellm-panel/LiteLLMTeamMembersPanel";
import { PanelSkeleton } from "@/components/settings/litellm-panel/PanelSkeleton";
import { SpendSourceTable } from "@/components/settings/litellm-panel/SpendSourceTable";
import {
  TeamLinkForm,
  type AppTeamChoices,
  type LiteLLMTeamList,
} from "@/components/settings/litellm-panel/TeamLinkForm";
import { TeamLinkNewTeamForm } from "@/components/settings/litellm-panel/TeamLinkNewTeamForm";
import { TeamLinkRow } from "@/components/settings/litellm-panel/TeamLinkRow";
import {
  SORT_PARAMS,
  SortableHeader,
  readSort,
} from "@/components/tables/SortableHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchApi } from "@/lib/query/fetch-api";

const TEAM_SORT_KEYS = ["team"] as const;

// Management -> LiteLLM -> LiteLLM teams (D3, 2026-11-17): the link rows, the
// LiteLLM teams table with a Members action (RS2), a "Spend source" table for
// the app teams linked to a LiteLLM team only (LF1 D-LF3, 2026-11-18), and the
// link / New LiteLLM team forms, which still choose from every app team.
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
  const [sortParams] = useQueryStates(SORT_PARAMS);
  const [openTeam, setOpenTeam] = useState<string | null>(null);
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
  const teamSort = readSort(
    sortParams.sort,
    sortParams.dir,
    "",
    TEAM_SORT_KEYS,
  );
  const sortedTeams =
    litellmTeams.state === "ready"
      ? teamSort.key === "team"
        ? [...litellmTeams.teams].sort(
            (a, b) =>
              (teamSort.dir === "asc" ? 1 : -1) *
              a.alias.localeCompare(b.alias),
          )
        : litellmTeams.teams
      : [];
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
      {litellmTeams.state === "ready" && litellmTeams.teams.length > 0 ? (
        <>
          <Table>
            <TableCaption className="sr-only">LiteLLM teams</TableCaption>
            <TableHeader>
              <TableRow>
                <SortableHeader sortKey="team" sortKeys={TEAM_SORT_KEYS}>
                  LiteLLM team
                </SortableHeader>
                <TableHead>Members</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedTeams.map((team) => (
                <TableRow key={team.litellmTeamId}>
                  <TableCell>{team.alias}</TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={`Members of ${team.alias}`}
                      aria-pressed={openTeam === team.litellmTeamId}
                      onClick={() =>
                        setOpenTeam(
                          openTeam === team.litellmTeamId
                            ? null
                            : team.litellmTeamId,
                        )
                      }
                    >
                      Members
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {litellmTeams.teams.find((t) => t.litellmTeamId === openTeam) ? (
            <LiteLLMTeamMembersPanel
              key={openTeam}
              litellmTeamId={openTeam ?? ""}
              teamName={
                litellmTeams.teams.find((t) => t.litellmTeamId === openTeam)
                  ?.alias ?? ""
              }
              canReset={canEdit}
            />
          ) : null}
        </>
      ) : null}
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
