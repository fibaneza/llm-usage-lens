"use client";

import { parseAsString, useQueryState } from "nuqs";
import { useId } from "react";

import { Panel } from "@/components/display/Panel";
import { PageHeader } from "@/components/layout/PageHeader";
import { LiteLLMReportedBadge } from "@/components/litellm/LiteLLMReportedBadge";
import { NativeSelect } from "@/components/litellm/team/native-select";
import { Skeleton } from "@/components/ui/skeleton";

import { TeamSpendPanel } from "./TeamSpendPanel";

const DESCRIPTION = "LiteLLM-reported spend for your teams";

type TeamUsageContentProps = {
  teams: readonly { teamId: string; teamName: string; linked: boolean }[];
  // A global reader may ask for the member sum; a Lead never does (LT28).
  includeMemberSum: boolean;
  // The ScopeLine label for a non-global caller (scopeLabelFor), else null.
  scopeLabel: string | null;
};

// The Team usage page body (Design System - Management pages, Team usage;
// unit M2): the spend the Team page used to show, one team at a time.
export function TeamUsageContent({
  teams,
  includeMemberSum,
  scopeLabel,
}: TeamUsageContentProps) {
  const selectId = useId();
  const [picked, setPicked] = useQueryState(
    "team",
    parseAsString.withOptions({ history: "push" }),
  );
  const team = teams.find((t) => t.teamId === picked) ?? teams[0];

  if (!team) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader description={DESCRIPTION} />
        <p className="text-muted-foreground text-sm">
          You have no teams to show.
        </p>
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
        {teams.length > 1 ? (
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
        ) : null}
      </PageHeader>
      <Panel
        title="Team spend"
        boundaryTitle="team spend"
        badge={<LiteLLMReportedBadge />}
        description="Daily figures are UTC days."
        skeleton={<Skeleton className="h-40 w-full" />}
        resetKeys={[team.teamId]}
      >
        <TeamSpendPanel
          teamId={team.teamId}
          includeMemberSum={includeMemberSum}
        />
      </Panel>
    </div>
  );
}
