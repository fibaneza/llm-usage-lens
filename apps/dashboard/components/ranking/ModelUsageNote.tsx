import { Info } from "lucide-react";

// Data Model spec -- Non-model charges (Guardrails, Provisioned Throughput,
// Knowledge Base storage and the like) are account-level only: `nonModel` has no
// byUser / byService breakdown, so the user and service views exclude them. The
// note keeps that gap from being mistaken for missing data. Department and team
// totals use rollup `cost`, which includes `nonModel`, so those tabs carry none.
export function ModelUsageNote() {
  return (
    <p
      role="note"
      className="bg-card text-muted-foreground flex items-start gap-2 rounded-md border px-3 py-2 text-sm"
    >
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        <strong className="text-foreground font-medium">
          Model usage only.
        </strong>{" "}
        Non-model charges, such as Guardrails, Provisioned Throughput and
        Knowledge Base storage, are account-level and are not attributed to
        users or services, so these figures can be lower than department and
        team totals.
      </span>
    </p>
  );
}
