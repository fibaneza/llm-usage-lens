"use client";

import { parseAsString, useQueryState } from "nuqs";
import { useId, type ReactNode } from "react";

import { Panel } from "@/components/display/Panel";
import { SectionBoundary } from "@/components/display/SectionBoundary";
import { PageHeader } from "@/components/layout/PageHeader";
import { LiteLLMReportedBadge } from "@/components/litellm/LiteLLMReportedBadge";
import { BudgetLimitsPanel } from "@/components/litellm/team/BudgetLimitsPanel";
import { KeysPanel } from "@/components/litellm/team/KeysPanel";
import { MembersPanel } from "@/components/litellm/team/MembersPanel";
import { ModelsPanel } from "@/components/litellm/team/ModelsPanel";
import { NativeSelect } from "@/components/litellm/team/native-select";
import { useMeQuery } from "@/components/litellm/use-me-query";
import { useTeamSpendDetail } from "@/components/litellm/use-team-detail";
import { Skeleton } from "@/components/ui/skeleton";

import { TeamSpendPanel } from "./TeamSpendPanel";

const PANEL_SKELETON = <Skeleton className="h-40 w-full" />;
const DESCRIPTION =
  "Spend, budgets, members, keys and models for your teams, as LiteLLM reports them.";

// LD37: when LiteLLM is not configured the L4 panels and their controls are
// not rendered, so none of their routes is called. Shares the spend panel's
// query, so it adds no request.
function WhenConfigured({
  teamId,
  children,
}: {
  teamId: string;
  children: ReactNode;
}) {
  const result = useTeamSpendDetail(teamId);
  if (result.status === "ok" && result.data.configured === false) return null;
  return <>{children}</>;
}

type TeamPageContentProps = {
  // True for internal-admin only; everyone else lowers (LiteLLM spec - LD26).
  canRaiseLimits: boolean;
  // The ScopeLine label for a non-global caller (scopeLabelFor), else null.
  scopeLabel: string | null;
  // Server-rendered team-level access sections, when the caller has any.
  access?: ReactNode;
};

// The Team Management page body (Design System - Management pages, Team; LiteLLM
// spec - Team configuration page, LD25; slice B2, B2-4). The server gate decides
// who gets here and the routes enforce every write again; each panel hides the
// controls whose operation is not enabled.
export function TeamPageContent({
  canRaiseLimits,
  scopeLabel,
  access,
}: TeamPageContentProps) {
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
  const teams = me.data.data.teams;
  const team = teams.find((t) => t.teamId === picked) ?? teams[0];
  if (!team) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader description={DESCRIPTION} />
        <p className="text-muted-foreground text-sm">
          You have no teams to manage.
        </p>
        {access}
      </div>
    );
  }

  const panel = (title: string, reported = false) => ({
    title,
    boundaryTitle: title.toLowerCase(),
    skeleton: PANEL_SKELETON,
    resetKeys: [team.teamId],
    badge: reported ? <LiteLLMReportedBadge /> : undefined,
  });
  const capabilities = { canRaiseLimits };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        description={DESCRIPTION}
        scopeLine={
          scopeLabel
            ? { label: scopeLabel, names: teams.map((t) => t.teamName) }
            : undefined
        }
      >
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
          <Panel
            {...panel("Team spend & budgets", true)}
            description="Daily figures are UTC days."
          >
            <TeamSpendPanel teamId={team.teamId} />
          </Panel>
          <SectionBoundary
            title="LiteLLM panels"
            fallback={PANEL_SKELETON}
            resetKeys={[team.teamId]}
          >
            <WhenConfigured teamId={team.teamId}>
              <Panel {...panel("LiteLLM members", true)}>
                <MembersPanel
                  teamId={team.teamId}
                  capabilities={capabilities}
                />
              </Panel>
              <Panel {...panel("Keys", true)}>
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
            </WhenConfigured>
          </SectionBoundary>
        </>
      ) : (
        <Panel {...panel("Team spend", true)}>
          <TeamSpendPanel teamId={team.teamId} />
        </Panel>
      )}
      {access}
    </div>
  );
}
