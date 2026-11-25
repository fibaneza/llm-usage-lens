"use client";

import { CombinedPersonCard } from "@/components/litellm/combined/CombinedPersonCard";
import { LiteLLMReportedBadge } from "@/components/litellm/LiteLLMReportedBadge";
import { Unavailable } from "@/components/litellm/LiteLLMSection";
import { Panel } from "@/components/display/Panel";

import { useProxyUser } from "./use-proxy-user";
import { budget, spend } from "./user-figures";

// Design System - LiteLLM user page (unit LP2), T-LP8; LiteLLM spec - LD23:
// under the Organisation cap spend and budget are omitted (no figure).
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

function SummaryBody({ litellmUserId }: { litellmUserId: string }) {
  const result = useProxyUser(litellmUserId);
  if (result.status !== "ok") return <Unavailable />;
  const user = result.data;
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
        <Field label="User id">
          <span className="font-mono break-all">{user.userId}</span>
        </Field>
        <Field label="Email">{user.email}</Field>
        <Field label="Spend">
          <span className="font-mono tabular-nums">{spend(user.spend)}</span>
        </Field>
        <Field label="Budget">
          <span className="font-mono tabular-nums">
            {budget(user.maxBudget)}
          </span>
        </Field>
      </dl>
      {user.combined ? (
        <CombinedPersonCard
          title="Combined usage"
          response={user.combined}
          headingLevel={3}
        />
      ) : null}
    </div>
  );
}

export function ProxyUserSummaryPanel({
  litellmUserId,
}: {
  litellmUserId: string;
}) {
  return (
    <Panel
      title="Summary"
      boundaryTitle="Summary"
      badge={<LiteLLMReportedBadge />}
    >
      <SummaryBody litellmUserId={litellmUserId} />
    </Panel>
  );
}
