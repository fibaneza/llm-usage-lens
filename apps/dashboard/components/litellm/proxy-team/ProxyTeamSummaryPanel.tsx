"use client";

import { Panel } from "@/components/display/Panel";
import { formatUsd } from "@/components/charts/chart-data";
import { formatSydneyTime } from "@/components/litellm/sydney-time";
import { BudgetBar } from "@/components/manage/BudgetBar";

import { useProxyTeam } from "./use-proxy-team";

// Design System - LiteLLM team page (unit LP1), T-LP4; LiteLLM spec - LD20,
// LD23: under the Organisation cap spend and budget are omitted, so no figure
// and no bar are drawn.
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground text-cell">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function SummaryBody({ litellmTeamId }: { litellmTeamId: string }) {
  const result = useProxyTeam(litellmTeamId);
  if (result.status !== "ok") {
    return (
      <p className="text-muted-foreground text-sm">
        LiteLLM is unavailable right now.
      </p>
    );
  }
  const team = result.data;
  const hasSpend = team.spend !== undefined;
  return (
    <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
      <Field label="Alias">{team.alias}</Field>
      <Field label="Team id">
        <span className="font-mono break-all">{team.litellmTeamId}</span>
      </Field>
      <Field label="Members">
        <span className="font-mono tabular-nums">{team.memberCount}</span>
      </Field>
      <Field label="Models">
        {team.models.length === 0 ? (
          <span className="text-muted-foreground">None</span>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {team.models.map((model) => (
              <li
                key={model}
                className="bg-muted rounded-control px-2 py-0.5 font-mono text-xs"
              >
                {model}
              </li>
            ))}
          </ul>
        )}
      </Field>
      {hasSpend ? (
        <>
          <Field label="Spend">
            <span className="font-mono tabular-nums">
              {formatUsd(team.spend ?? 0)}
            </span>
          </Field>
          <Field label="Budget">
            {team.maxBudget ? (
              <span className="flex flex-wrap items-center gap-3">
                <span className="font-mono tabular-nums">
                  {formatUsd(team.maxBudget)}
                </span>
                <BudgetBar spend={team.spend ?? 0} budget={team.maxBudget} />
              </span>
            ) : (
              <BudgetBar spend={team.spend ?? 0} budget={null} />
            )}
          </Field>
          {team.maxBudget && team.budgetResetAt ? (
            <Field label="Budget resets">
              {formatSydneyTime(team.budgetResetAt)}
            </Field>
          ) : null}
          {team.maxBudget && !team.budgetResetAt ? (
            <div className="text-sm">
              <dt className="text-muted-foreground text-cell inline">
                Budget resets:
              </dt>{" "}
              <dd className="inline">Not set</dd>
            </div>
          ) : null}
        </>
      ) : null}
    </dl>
  );
}

export function ProxyTeamSummaryPanel({
  litellmTeamId,
}: {
  litellmTeamId: string;
}) {
  return (
    <Panel title="Summary" boundaryTitle="Summary">
      <SummaryBody litellmTeamId={litellmTeamId} />
    </Panel>
  );
}
