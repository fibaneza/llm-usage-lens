"use client";

import { useQuery } from "@tanstack/react-query";

import { LiteLLMUsersList } from "@/components/manage/users/LiteLLMUsersList";
import {
  TEAM_LINKS_KEY,
  TeamLinksSchema,
} from "@/components/settings/litellm-panel/keys";
import { fetchApi } from "@/lib/query/fetch-api";

// Design System "Settings Page" - LiteLLM sub-tabs, agent decision (3): the
// note shows only once the links have loaded and none exist (gap G7). From
// unit M3 (D16a) the tab is the users list with link states.
export function LiteLLMUsersSection({
  canReset = false,
}: {
  canReset?: boolean;
}) {
  const links = useQuery({
    queryKey: TEAM_LINKS_KEY,
    queryFn: () => fetchApi("/api/litellm/team-links", TeamLinksSchema),
  });
  return (
    <div className="flex flex-col gap-3">
      {links.data && links.data.items.length === 0 ? (
        <p role="status" className="text-muted-foreground max-w-[72ch] text-sm">
          No LiteLLM team is linked yet. User search lists LiteLLM users; a
          user&apos;s spend appears per team once a team is linked under Team
          links.
        </p>
      ) : null}
      <LiteLLMUsersList canReset={canReset} />
    </div>
  );
}
