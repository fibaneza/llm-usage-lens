"use client";

import { CircleDollarSign, Wallet } from "lucide-react";

import { formatUsd } from "@/components/charts/chart-data";
import { EmptyState } from "@/components/display/EmptyState";
import { MetricCard } from "@/components/display/MetricCard";

import { DailySpend } from "./DailySpend";
import { KeysTable } from "./KeysTable";
import { LiteLLMMeResponseSchema } from "@llm-usage-lens/shared";
import { Unavailable } from "./LiteLLMSection";
import { useLiteLLMQuery } from "./use-litellm-query";

export function MyUsageSection() {
  const result = useLiteLLMQuery(
    ["me"],
    "/api/litellm/me",
    LiteLLMMeResponseSchema,
  );
  if (result.status === "unavailable") return <Unavailable />;
  const me = result.data;
  if (!me.linked) {
    return (
      <EmptyState
        title="Your account is not linked to LiteLLM"
        description="Ask your administrator to link your LiteLLM user."
      />
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <MetricCard
          title="Spend"
          value={formatUsd(me.spend)}
          icon={CircleDollarSign}
        />
        <MetricCard
          title="Budget"
          value={me.maxBudget === null ? "No limit" : formatUsd(me.maxBudget)}
          icon={Wallet}
        />
      </div>
      <DailySpend daily={me.daily} />
      {me.keys.length > 0 ? (
        <KeysTable keys={me.keys} caption="Your keys" />
      ) : null}
    </div>
  );
}
