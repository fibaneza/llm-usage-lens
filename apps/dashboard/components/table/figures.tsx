"use client";

import { createContext, useContext } from "react";

import { formatUsd } from "@/components/charts/chart-data";

export type FigureFormat = "full" | "compact";

// Design System -- UX Standards ("abbreviated large numbers, $12.5K") and
// Responsive Tables ("≥ md: full table -- all columns", no horizontal scroll).
// The desktop table abbreviates figures so every column fits beside the open
// sidebar; the mobile cards sit outside this provider and keep the full
// figures. Default is "full".
const FigureFormatContext = createContext<FigureFormat>("full");

export const FigureFormatProvider = FigureFormatContext.Provider;

export function useFigureFormat(): FigureFormat {
  return useContext(FigureFormatContext);
}

const countFormatter = new Intl.NumberFormat("en-US");
const compactCountFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const compactUsdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

// Below 1,000 the compact form would drop cents ($0.42 -> $0.4), so small
// amounts keep the standard currency format.
const COMPACT_THRESHOLD = 1000;

type FigureProps = {
  value: number;
  className?: string;
};

// The full value stays in `title` so nothing is lost when the display is
// abbreviated.
export function UsdFigure({ value, className }: FigureProps) {
  const full = formatUsd(value);
  const compact =
    useFigureFormat() === "compact" && Math.abs(value) >= COMPACT_THRESHOLD;

  return (
    <span className={className} title={compact ? full : undefined}>
      {compact ? compactUsdFormatter.format(value) : full}
    </span>
  );
}

export function CountFigure({ value, className }: FigureProps) {
  const full = countFormatter.format(value);
  const compact = useFigureFormat() === "compact";
  const abbreviated = compact ? compactCountFormatter.format(value) : full;

  return (
    <span className={className} title={abbreviated === full ? undefined : full}>
      {abbreviated}
    </span>
  );
}
