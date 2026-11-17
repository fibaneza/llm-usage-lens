"use client";

import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";

import {
  TEAM_LINKS_KEY,
  TeamLinksSchema,
} from "@/components/settings/litellm-panel/keys";
import { PanelSkeleton } from "@/components/settings/litellm-panel/PanelSkeleton";
import { TeamLinkForm } from "@/components/settings/litellm-panel/TeamLinkForm";
import { TeamLinkRow } from "@/components/settings/litellm-panel/TeamLinkRow";
import { Input } from "@/components/ui/input";
import { fetchApi } from "@/lib/query/fetch-api";

export function LiteLLMTeamLinksSection({ canEdit }: { canEdit: boolean }) {
  const searchId = useId();
  const [term, setTerm] = useState("");
  const query = useQuery({
    queryKey: TEAM_LINKS_KEY,
    queryFn: () => fetchApi("/api/litellm/team-links", TeamLinksSchema),
  });

  if (query.isError) {
    return (
      <p role="alert" className="text-destructive text-sm">
        {query.error.message}
      </p>
    );
  }
  if (query.data === undefined) return <PanelSkeleton />;

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
      {canEdit ? <TeamLinkForm links={query.data.items} /> : null}
    </div>
  );
}
