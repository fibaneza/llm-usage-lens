"use client";

import { parseAsString, useQueryState } from "nuqs";
import { useId } from "react";

import { Panel } from "@/components/display/Panel";
import { PageHeader } from "@/components/layout/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";

import { NotConnected } from "./LiteLLMSection";
import { BudgetLimitsPanel } from "./team/BudgetLimitsPanel";
import { KeysPanel } from "./team/KeysPanel";
import { MembersPanel } from "./team/MembersPanel";
import { ModelsPanel } from "./team/ModelsPanel";
import { NativeSelect } from "./team/native-select";
import { useMeQuery } from "./use-me-query";

const PANEL_SKELETON = <Skeleton className="h-40 w-full" />;

// The interim page behind "Configure team" (LiteLLM spec -- Team configuration
// page, LD25): the team picker and the four panels, which Slice B mounts on
// /dashboard/manage/team. The server gate decides who gets here;
// `canRaiseLimits` is true for Admin and org-admin, and a Lead only lowers
// (the routes enforce it).
export function TeamConfigContent({
  canRaiseLimits,
}: {
  canRaiseLimits: boolean;
}) {
  const selectId = useId();
  const [picked, setPicked] = useQueryState("team", parseAsString);
  const me = useMeQuery();

  if (me.isPending) return <Skeleton className="h-40 w-full" />;
  if (me.data?.status !== "ok") {
    return (
      <p role="alert" className="text-muted-foreground text-sm">
        LiteLLM unavailable
      </p>
    );
  }
  const teams = me.data.data.teams.filter((t) => t.configurable === true);
  const team = teams.find((t) => t.teamId === picked) ?? teams[0];
  if (!team) {
    return (
      <p className="text-muted-foreground text-sm">
        You have no teams to configure.
      </p>
    );
  }

  const panel = (title: string) => ({
    title,
    boundaryTitle: title.toLowerCase(),
    skeleton: PANEL_SKELETON,
    resetKeys: [team.teamId],
  });
  const capabilities = { canRaiseLimits };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader>
        <div className="flex items-center gap-2">
          <label htmlFor={selectId} className="text-cell font-medium">
            Team
          </label>
          <NativeSelect
            id={selectId}
            className="w-auto"
            value={team.teamId}
            onChange={(e) => void setPicked(e.target.value)}
          >
            {teams.map((t) => (
              <option key={t.teamId} value={t.teamId}>
                {t.teamName}
              </option>
            ))}
          </NativeSelect>
        </div>
      </PageHeader>
      {team.linked ? (
        <>
          <Panel {...panel("Members")}>
            <MembersPanel teamId={team.teamId} capabilities={capabilities} />
          </Panel>
          <Panel {...panel("Keys")}>
            <KeysPanel teamId={team.teamId} capabilities={capabilities} />
          </Panel>
          <Panel {...panel("Budget and limits")}>
            <BudgetLimitsPanel
              teamId={team.teamId}
              capabilities={capabilities}
            />
          </Panel>
          <Panel {...panel("Models")}>
            <ModelsPanel teamId={team.teamId} capabilities={capabilities} />
          </Panel>
        </>
      ) : (
        <Panel {...panel("Members")}>
          <NotConnected />
        </Panel>
      )}
    </div>
  );
}
