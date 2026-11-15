"use client";

import { parseAsStringLiteral, useQueryState } from "nuqs";

import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LiteLLMMeResponseSchema } from "@llm-usage-lens/shared";

import { AuditSection } from "./AuditSection";
import { LiteLLMSection } from "./LiteLLMSection";
import { MyUsageSection } from "./MyUsageSection";
import { OrganisationSection } from "./OrganisationSection";
import { TeamArea } from "./TeamArea";
import { UserSearch } from "./UserSearch";
import { useLiteLLMQueryState } from "./use-litellm-query";

export const LITELLM_TAB_IDS = [
  "my-usage",
  "team",
  "organisation",
  "users",
  "audit",
] as const;
export type LiteLLMTabId = (typeof LITELLM_TAB_IDS)[number];

const TAB_LABELS: Record<LiteLLMTabId, string> = {
  "my-usage": "My usage",
  team: "Team",
  organisation: "Organisation",
  users: "Users",
  audit: "Audit",
};

const tabParser = parseAsStringLiteral(LITELLM_TAB_IDS);

// LiteLLM page body (LiteLLM spec -- Views by role, L3b). `tabs` is the
// server-resolved ceiling; the Team tab also needs the caller to have teams.
// The routes enforce every role again. The selected tab is URL state
// (Rule 40.5); unknown or disallowed values fall back to My usage, and only
// the selected tab's sections mount, so other tabs make no requests.
export function LiteLLMContent({ tabs }: { tabs: readonly LiteLLMTabId[] }) {
  const [requested, setRequested] = useQueryState("tab", tabParser);
  const wantsTeam = tabs.includes("team");
  const me = useLiteLLMQueryState(
    ["me"],
    "/api/litellm/me",
    LiteLLMMeResponseSchema,
  );

  if (wantsTeam && me.isPending) return <Skeleton className="h-40 w-full" />;

  const hasTeams = me.data?.status === "ok" && me.data.data.teams.length > 0;
  const visible = LITELLM_TAB_IDS.filter(
    (id) => tabs.includes(id) && (id !== "team" || hasTeams),
  );
  const selected =
    requested !== null && visible.includes(requested) ? requested : "my-usage";

  return (
    <Tabs
      value={selected}
      onValueChange={(value) => {
        const next = tabParser.parse(value);
        if (next !== null) void setRequested(next);
      }}
    >
      <TabsList aria-label="LiteLLM views">
        {visible.map((id) => (
          <TabsTrigger key={id} value={id}>
            {TAB_LABELS[id]}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="my-usage">
        <LiteLLMSection title="My usage" reported>
          <MyUsageSection />
        </LiteLLMSection>
      </TabsContent>
      {/* Named apart from the tab so the "Team" picker stays the only "Team" label. */}
      <TabsContent
        value="team"
        aria-labelledby={undefined}
        aria-label="Team views"
      >
        <TeamArea />
      </TabsContent>
      <TabsContent value="organisation">
        <LiteLLMSection title="Organisation" reported>
          <OrganisationSection />
        </LiteLLMSection>
      </TabsContent>
      <TabsContent value="users">
        <LiteLLMSection title="Users">
          <UserSearch />
        </LiteLLMSection>
      </TabsContent>
      <TabsContent value="audit">
        <LiteLLMSection title="LiteLLM audit">
          <AuditSection />
        </LiteLLMSection>
      </TabsContent>
    </Tabs>
  );
}
