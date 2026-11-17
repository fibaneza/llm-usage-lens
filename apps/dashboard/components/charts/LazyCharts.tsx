"use client";

import dynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/skeleton";

// Recharts is browser-only and heavy: load each chart on demand, never during
// SSR (Rule 40.3, 60.11).
function ChartSkeleton() {
  return <Skeleton className="h-72 w-full" />;
}

export const LazyCostTrendChart = dynamic(
  () => import("./CostTrendChart").then((m) => m.CostTrendChart),
  { ssr: false, loading: ChartSkeleton },
);

export const LazyDailyCostBarChart = dynamic(
  () => import("./DailyCostBarChart").then((m) => m.DailyCostBarChart),
  { ssr: false, loading: ChartSkeleton },
);

export const LazyModelBreakdownChart = dynamic(
  () => import("./ModelBreakdownChart").then((m) => m.ModelBreakdownChart),
  { ssr: false, loading: ChartSkeleton },
);

export const LazyTopDepartmentsChart = dynamic(
  () => import("./TopDepartmentsChart").then((m) => m.TopDepartmentsChart),
  { ssr: false, loading: ChartSkeleton },
);

export const LazyModelUsageBarChart = dynamic(
  () => import("./ModelUsageBarChart").then((m) => m.ModelUsageBarChart),
  { ssr: false, loading: ChartSkeleton },
);
