"use client";

import { useState } from "react";

import { TeamResetCount } from "@/components/budget-resets/BudgetResetCount";
import { OpenResetRequests } from "@/components/budget-resets/OpenResetRequests";
import { KeyValueList } from "@/components/display/KeyValueList";
import { formatUsd } from "@/components/charts/chart-data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { NotConnected, Unavailable } from "../LiteLLMSection";
import type { TeamPanelProps } from "./panel-props";
import { WriteError } from "./write-parts";
import { useUrlRange } from "../use-litellm-query";
import { useTeamDetail } from "../use-team-detail";
import { teamPath, useTeamWrite } from "./use-team-write";

type Current = {
  maxBudget: number | null;
  rpmLimit: number | null;
  tpmLimit: number | null;
};

const text = (value: number | null) => (value === null ? "" : String(value));

// A Lead lowers only (LiteLLM spec -- Budgets and limits): the `max` hint is
// the current value, a client-side convenience; the API enforces the rule.
function Field({
  label,
  value,
  onChange,
  ceiling,
  step,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  ceiling: number | undefined;
  step: number | "any";
}) {
  return (
    <label className="grid gap-1 text-sm font-medium">
      {label}
      <Input
        type="number"
        min={step === "any" ? 0 : 1}
        step={step}
        {...(ceiling === undefined ? {} : { max: ceiling })}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function BudgetAndLimits({
  teamId,
  current,
  canSetBudget,
  canSetLimits,
  canRaiseLimits,
  canApprove,
}: {
  teamId: string;
  current: Current;
  canSetBudget: boolean;
  canSetLimits: boolean;
  canRaiseLimits: boolean;
  canApprove: boolean;
}) {
  const { write, pending, error } = useTeamWrite(teamId);
  const { keyParts } = useUrlRange();
  const range = { dateFrom: keyParts[0], dateTo: keyParts[1] };
  const [budget, setBudget] = useState(text(current.maxBudget));
  const [rpm, setRpm] = useState(text(current.rpmLimit));
  const [tpm, setTpm] = useState(text(current.tpmLimit));
  const ceiling = (value: number | null) =>
    canRaiseLimits || value === null ? undefined : value;
  // Only a changed, non-empty field is sent.
  const changed = (value: string, was: number | null) =>
    value.trim() !== "" && Number(value) !== was ? Number(value) : undefined;

  const maxBudget = changed(budget, current.maxBudget);
  const rpmLimit = changed(rpm, current.rpmLimit);
  const tpmLimit = changed(tpm, current.tpmLimit);

  return (
    <div className="flex flex-col gap-4">
      <KeyValueList
        items={[
          {
            term: "Current budget",
            value:
              current.maxBudget === null
                ? "No limit"
                : formatUsd(current.maxBudget),
            mono: true,
          },
          {
            term: "Current rate limits",
            value: (
              <span className="flex min-w-0 flex-col py-1">
                <span>{`${current.rpmLimit ?? "No limit"} req/min`}</span>
                <span>{`${current.tpmLimit ?? "No limit"} tokens/min`}</span>
              </span>
            ),
            mono: true,
          },
        ]}
      />
      <WriteError message={error} />
      {canSetBudget ? (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void write(teamPath(teamId, "/budget"), "PATCH", { maxBudget }, [
              "detail",
            ]);
          }}
        >
          <Field
            label="Max budget (USD)"
            value={budget}
            onChange={setBudget}
            ceiling={ceiling(current.maxBudget)}
            step="any"
          />
          <Button type="submit" disabled={pending || maxBudget === undefined}>
            Save budget
          </Button>
        </form>
      ) : null}
      {canSetLimits ? (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void write(
              teamPath(teamId, "/limits"),
              "PATCH",
              {
                ...(rpmLimit === undefined ? {} : { rpmLimit }),
                ...(tpmLimit === undefined ? {} : { tpmLimit }),
              },
              ["detail"],
            );
          }}
        >
          <Field
            label="Requests per minute"
            value={rpm}
            onChange={setRpm}
            ceiling={ceiling(current.rpmLimit)}
            step={1}
          />
          <Field
            label="Tokens per minute"
            value={tpm}
            onChange={setTpm}
            ceiling={ceiling(current.tpmLimit)}
            step={1}
          />
          <Button
            type="submit"
            disabled={
              pending || (rpmLimit === undefined && tpmLimit === undefined)
            }
          >
            Save limits
          </Button>
        </form>
      ) : null}
      <TeamResetCount teamId={teamId} range={range} />
      <OpenResetRequests teamId={teamId} canApprove={canApprove} />
    </div>
  );
}

export function BudgetLimitsPanel({
  teamId,
  capabilities: { canRaiseLimits },
}: TeamPanelProps) {
  const detail = useTeamDetail(teamId);
  if (detail.status === "unavailable") return <Unavailable />;
  if (detail.data.configured === false || !detail.data.connected)
    return <NotConnected />;
  const { team, enabledOperations } = detail.data;
  const { maxBudget, rpmLimit, tpmLimit } = team;
  return (
    <BudgetAndLimits
      // Re-initialise the inputs when a save refetches new current values.
      key={`${teamId}:${maxBudget}:${rpmLimit}:${tpmLimit}`}
      teamId={teamId}
      current={{ maxBudget, rpmLimit, tpmLimit }}
      canSetBudget={enabledOperations.includes("setTeamBudget")}
      canSetLimits={enabledOperations.includes("setTeamLimits")}
      canRaiseLimits={canRaiseLimits}
      canApprove={enabledOperations.includes("resetMemberSpend")}
    />
  );
}
