"use client";

import { parseAsString, parseAsStringLiteral, useQueryState } from "nuqs";
import { Fragment, useId, type ReactNode } from "react";

import { Panel } from "@/components/display/Panel";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageTabs } from "@/components/layout/PageTabs";
import { LiteLLMReportedBadge } from "@/components/litellm/LiteLLMReportedBadge";
import { BudgetLimitsPanel } from "@/components/litellm/team/BudgetLimitsPanel";
import { KeysPanel } from "@/components/litellm/team/KeysPanel";
import { MembersPanel } from "@/components/litellm/team/MembersPanel";
import { ModelsPanel } from "@/components/litellm/team/ModelsPanel";
import { NativeSelect } from "@/components/litellm/team/native-select";
import { useMeQuery } from "@/components/litellm/use-me-query";
import { useTeamDetailState } from "@/components/litellm/use-team-detail";
import { Skeleton } from "@/components/ui/skeleton";

import { TeamSpendPanel } from "./TeamSpendPanel";

const PANEL_SKELETON = <Skeleton className="h-40 w-full" />;
const DESCRIPTION =
  "Spend, budgets, members, keys and models for your teams, as LiteLLM reports them.";

const VIEWS = ["members", "budgets", "keys"] as const;
const VIEW_ITEMS = [
  { value: "members", label: "Members" },
  { value: "budgets", label: "Budgets" },
  { value: "keys", label: "Keys" },
] as const;
// An unknown ?view= parses to null and takes the default; each tab is a
// history entry so Back steps through the views (Design System - Management
// pages, Team page views and links).
const viewParser = parseAsStringLiteral(VIEWS)
  .withDefault("members")
  .withOptions({ history: "push" });

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
        <LinkedTeamViews
          teamId={team.teamId}
          capabilities={{ canRaiseLimits }}
          access={access}
        />
      ) : (
        <>
          <SpendPanel teamId={team.teamId} withBudgets={false} />
          {access}
        </>
      )}
    </div>
  );
}

const panelProps = (teamId: string, title: string, reported = false) => ({
  title,
  boundaryTitle: title.toLowerCase(),
  skeleton: PANEL_SKELETON,
  resetKeys: [teamId],
  badge: reported ? <LiteLLMReportedBadge /> : undefined,
});

function SpendPanel({
  teamId,
  withBudgets,
}: {
  teamId: string;
  withBudgets: boolean;
}) {
  const title = withBudgets ? "Team spend & budgets" : "Team spend";
  return (
    <Panel
      {...panelProps(teamId, title, true)}
      description={withBudgets ? "Daily figures are UTC days." : undefined}
    >
      <TeamSpendPanel teamId={teamId} />
    </Panel>
  );
}

// Linked team: the Members, Budgets and Keys views on the one Tabs component,
// only the active view mounted (Design System - Management pages, Team page
// views and links). LiteLLM not configured (LD37) leaves Members alone, with
// the spend panel saying so above it and no tabs. An outage does not hide a
// view, and the tabs show while the detail loads.
//
// The views sit in PageTabs; the not-configured state renders no tabs at all.
function LinkedTeamViews({
  teamId,
  capabilities,
  access,
}: {
  teamId: string;
  capabilities: { canRaiseLimits: boolean };
  access: ReactNode;
}) {
  const [requested, setView] = useQueryState("view", viewParser);
  const detail = useTeamDetailState(teamId);
  const panel = (title: string, reported = false) =>
    panelProps(teamId, title, reported);

  const showTabs = !(
    detail.data?.status === "ok" && detail.data.data.configured === false
  );
  const view = showTabs ? requested : "budgets";

  // The L4 panels mount once the detail has answered, so a team that is not
  // configured never calls their routes.
  const gated = (children: ReactNode) =>
    detail.isPending ? PANEL_SKELETON : children;

  const accessSlot = <Fragment key="access">{access}</Fragment>;
  // Mounted at once, beside the detail read, so the member-sum read does not
  // wait on it (Design System - Performance patterns, no request waterfalls).
  const spend = <SpendPanel key="spend" teamId={teamId} withBudgets />;
  const content = !showTabs
    ? [spend, accessSlot]
    : view === "members"
      ? [
          <Panel key="members" {...panel("LiteLLM members", true)}>
            {gated(
              <MembersPanel teamId={teamId} capabilities={capabilities} />,
            )}
          </Panel>,
          accessSlot,
        ]
      : view === "budgets"
        ? [
            spend,
            <Panel key="budget" {...panel("Budget and limits")}>
              {gated(
                <BudgetLimitsPanel
                  teamId={teamId}
                  capabilities={capabilities}
                />,
              )}
            </Panel>,
          ]
        : [
            <Panel key="keys" {...panel("Keys", true)}>
              {gated(<KeysPanel teamId={teamId} capabilities={capabilities} />)}
            </Panel>,
            <Panel key="models" {...panel("Models")}>
              {gated(
                <ModelsPanel teamId={teamId} capabilities={capabilities} />,
              )}
            </Panel>,
          ];

  // One tree for both states: the spend panel (and its in-flight read) is not
  // remounted when the detail answers "not configured" and the tab list goes.
  return (
    <PageTabs
      hideList={!showTabs}
      label="Team views"
      value={view}
      onValueChange={(next) => void setView(next)}
      items={VIEW_ITEMS}
      panelId="team-view-panel"
    >
      <div className="flex flex-col gap-4">{content}</div>
    </PageTabs>
  );
}
