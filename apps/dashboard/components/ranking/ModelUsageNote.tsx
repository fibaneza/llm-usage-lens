import { Info } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";

// Data Model spec -- Non-model charges (Guardrails, Provisioned Throughput,
// Knowledge Base storage and the like) are account-level only: `nonModel` has no
// byUser / byService breakdown, so the user and service views exclude them. The
// note keeps that gap from being mistaken for missing data. Department and team
// totals use rollup `cost`, which includes `nonModel`, so those tabs carry none.
export function ModelUsageNote() {
  return (
    <Alert role="note" className="items-center">
      <Info aria-hidden />
      <AlertDescription className="text-muted-foreground">
        <span>
          <strong className="text-foreground font-medium">
            Model usage only.
          </strong>{" "}
          Non-model charges, such as Guardrails, Provisioned Throughput and
          Knowledge Base storage, are account-level and are not attributed to
          users or services, so these figures can be lower than department and
          team totals.
        </span>
      </AlertDescription>
    </Alert>
  );
}
