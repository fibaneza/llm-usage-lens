"use client";

import { useId, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";

import { KeysSection } from "./KeysSection";
import { LiteLLMSection, NotConnected } from "./LiteLLMSection";
import { MembersSection } from "./MembersSection";
import { ModelAccessSection } from "./ModelAccessSection";
import { TeamSpendSection } from "./TeamSpendSection";
import { useMeQuery } from "./use-me-query";

// The team sections appear only for a caller with teams (LiteLLM spec -- Roles
// and rights). They share the `me` query with My usage; a failure there is
// already reported by that section, so this area stays out of the way.
export function TeamArea() {
  const selectId = useId();
  const [picked, setPicked] = useState<string | null>(null);
  const me = useMeQuery();

  if (me.isPending) return <Skeleton className="h-40 w-full" />;
  const teams = me.data?.status === "ok" ? me.data.data.teams : [];
  const team = teams.find((t) => t.teamId === picked) ?? teams[0];
  if (!team) return null;

  return (
    <>
      <div className="flex items-center gap-2">
        <label htmlFor={selectId} className="text-sm font-medium">
          Team
        </label>
        <select
          id={selectId}
          aria-label="Team"
          className="border-input bg-background h-9 rounded-md border px-3 text-sm"
          value={team.teamId}
          onChange={(e) => setPicked(e.target.value)}
        >
          {teams.map((t) => (
            <option key={t.teamId} value={t.teamId}>
              {t.teamName}
            </option>
          ))}
        </select>
      </div>
      {team.linked ? (
        <>
          <LiteLLMSection
            title="Team spend & budgets"
            reported
            resetKey={team.teamId}
          >
            <TeamSpendSection teamId={team.teamId} />
          </LiteLLMSection>
          <LiteLLMSection title="Members" reported resetKey={team.teamId}>
            <MembersSection teamId={team.teamId} />
          </LiteLLMSection>
          <LiteLLMSection title="Keys" reported resetKey={team.teamId}>
            <KeysSection teamId={team.teamId} />
          </LiteLLMSection>
          <LiteLLMSection title="Model access" resetKey={team.teamId}>
            <ModelAccessSection teamId={team.teamId} />
          </LiteLLMSection>
        </>
      ) : (
        <LiteLLMSection title="Team spend & budgets" resetKey={team.teamId}>
          <NotConnected />
        </LiteLLMSection>
      )}
    </>
  );
}
