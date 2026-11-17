"use client";

import { useState } from "react";
import type { ReactNode } from "react";

import { LiteLLMConnectionSection } from "@/components/settings/litellm-panel/LiteLLMConnectionSection";
import { LiteLLMGuardrailsSection } from "@/components/settings/litellm-panel/LiteLLMGuardrailsSection";
import { LiteLLMTeamLinksSection } from "@/components/settings/litellm-panel/LiteLLMTeamLinksSection";
import { LiteLLMUsersSection } from "@/components/settings/litellm-panel/LiteLLMUsersSection";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { LiteLLMPanelCapabilities } from "@/lib/auth/litellm-panel";

export type { LiteLLMPanelCapabilities };

// Settings -> LiteLLM, tabbed like the page (LiteLLM spec -- Views by role).
// A tab mounts on first visit (its data loads then) and stays mounted, hidden,
// so a visited tab keeps its state when the user switches away.
const TABS = ["connection", "guardrails", "team-links", "users"] as const;
type TabId = (typeof TABS)[number];

export function LiteLLMPanel({
  capabilities,
}: {
  capabilities: LiteLLMPanelCapabilities;
}) {
  const [active, setActive] = useState<TabId>("connection");
  const [visited, setVisited] = useState<ReadonlySet<TabId>>(
    new Set<TabId>(["connection"]),
  );
  const content = (id: TabId, body: ReactNode) => (
    <TabsContent value={id} forceMount hidden={active !== id}>
      {visited.has(id) ? body : null}
    </TabsContent>
  );
  return (
    <Tabs
      value={active}
      onValueChange={(v) => {
        const id = TABS.find((t) => t === v);
        if (id === undefined) return;
        setActive(id);
        setVisited((prev) => new Set(prev).add(id));
      }}
    >
      <TabsList aria-label="LiteLLM settings">
        <TabsTrigger value="connection">Connection</TabsTrigger>
        <TabsTrigger value="guardrails">Guardrails</TabsTrigger>
        <TabsTrigger value="team-links">Team links</TabsTrigger>
        <TabsTrigger value="users">Users</TabsTrigger>
      </TabsList>
      {content(
        "connection",
        <LiteLLMConnectionSection canEdit={capabilities.editConnection} />,
      )}
      {content(
        "guardrails",
        <LiteLLMGuardrailsSection canEdit={capabilities.editGuardrails} />,
      )}
      {content(
        "team-links",
        <LiteLLMTeamLinksSection canEdit={capabilities.editTeamLinks} />,
      )}
      {content("users", <LiteLLMUsersSection />)}
    </Tabs>
  );
}
