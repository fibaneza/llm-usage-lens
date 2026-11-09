import { MODEL_META, type DepartmentRow } from "@llm-usage-lens/shared";
import { Building2 } from "lucide-react";
import Link from "next/link";

import { formatUsd } from "@/components/charts/chart-data";
import { DeltaBadge } from "@/components/display/DeltaBadge";
import { MetricCard } from "@/components/display/MetricCard";

const countFormatter = new Intl.NumberFormat("en-US");

type DepartmentCardProps = {
  department: DepartmentRow;
  href: string;
  // Same department's cost in the previous period; null when it has none.
  previousCost: number | null;
};

// One department card (Design System -- Page Architecture, "Department cards
// grid"; Component Inventory, `MetricCard`). The whole card is the link, so
// nothing interactive nests inside it; the spaces between the lines keep the
// card's text content from fusing ("1 team" + "Top model"). A null `topModel`
// is a neutral "No model usage", never a fake model (Rule 20.5, 20.12).
export function DepartmentCard({
  department,
  href,
  previousCost,
}: DepartmentCardProps) {
  const tokens = department.inputTokens + department.outputTokens;
  const teams = department.teamCount === 1 ? "team" : "teams";
  const topModel =
    department.topModel === null
      ? "No model usage"
      : MODEL_META[department.topModel].displayName;

  return (
    <Link
      href={href}
      className="focus-visible:ring-ring block min-w-0 rounded-xl break-words outline-hidden focus-visible:ring-[3px]"
    >
      <MetricCard
        title={department.departmentName}
        value={formatUsd(department.cost)}
        icon={Building2}
        trend={<DeltaBadge current={department.cost} previous={previousCost} />}
        description={
          <>
            <p>{`${countFormatter.format(tokens)} tokens`}</p>{" "}
            <p>{`${department.teamCount} ${teams}`}</p>{" "}
            <p>{`Top model: ${topModel}`}</p>
          </>
        }
      />
    </Link>
  );
}
