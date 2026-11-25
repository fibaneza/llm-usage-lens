"use client";

import { Panel } from "@/components/display/Panel";
import {
  TeamEditDialog,
  type TeamEditTarget,
} from "@/components/manage/TeamEditDialog";

export type TeamSummaryLiteLLM = {
  linked: boolean;
  alias?: string;
  teamId?: string;
};

export type TeamSummaryPanelProps = {
  name: string;
  departmentName: string;
  kind: "registry" | "created";
  leadNames: string[];
  memberCount: number;
  // A caller who is not a global role gets { linked } only (Design System -
  // Team page, round 3, ruling Q-B1).
  litellm: TeamSummaryLiteLLM;
  budgetResetsInRange: number;
  canEdit: boolean;
  editTarget?: TeamEditTarget;
};

function LiteLLMTeamValue({ litellm }: { litellm: TeamSummaryLiteLLM }) {
  if (!litellm.linked) return <>Not linked</>;
  if (litellm.alias === undefined && litellm.teamId === undefined) {
    return <>Linked</>;
  }
  return (
    <>
      {litellm.alias !== undefined ? <span>{litellm.alias}</span> : null}
      {litellm.teamId !== undefined ? (
        <span className="text-muted-foreground ml-2 font-mono">
          {litellm.teamId}
        </span>
      ) : null}
    </>
  );
}

// Design System - Team page, round 3 (unit TP1), Summary and Edit team. The
// server builds the props per request; the panel prints only what it is given.
export function TeamSummaryPanel({
  name,
  departmentName,
  kind,
  leadNames,
  memberCount,
  litellm,
  budgetResetsInRange,
  canEdit,
  editTarget,
}: TeamSummaryPanelProps) {
  const editable = canEdit && kind === "created" && editTarget !== undefined;
  const rows: { label: string; value: React.ReactNode }[] = [
    { label: "Name", value: name },
    { label: "Department", value: departmentName },
    {
      label: "Kind",
      value: kind === "registry" ? "From an AWS account" : "Created here",
    },
    {
      label: "Team admins",
      value: leadNames.length > 0 ? leadNames.join(", ") : "None",
    },
    { label: "Members", value: memberCount },
    { label: "LiteLLM team", value: <LiteLLMTeamValue litellm={litellm} /> },
    { label: "Budget resets in range", value: budgetResetsInRange },
  ];

  return (
    <Panel
      title="Summary"
      boundaryTitle="summary"
      actions={editable ? <TeamEditDialog team={editTarget} /> : undefined}
    >
      <dl className="text-cell grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2">
        {rows.map((row) => (
          <div key={row.label} className="contents">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="min-w-0 break-words">{row.value}</dd>
          </div>
        ))}
      </dl>
      {kind === "registry" ? (
        <p className="text-cell text-muted-foreground mt-3">
          Edited in Settings → AWS accounts
        </p>
      ) : null}
    </Panel>
  );
}
