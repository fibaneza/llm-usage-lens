import { formatUsd } from "@/components/charts/chart-data";

// Per-user cost is absent until per-user reporting is approved (LiteLLM spec -
// LD23); Design System - LiteLLM user page, T-LP8.
export const HIDDEN_FIGURE = "Hidden until per-user reporting is approved";

export const budget = (value: number | null | undefined) =>
  value === undefined
    ? HIDDEN_FIGURE
    : value === null
      ? "No limit"
      : formatUsd(value);

// undefined: hidden by the cap. null: LiteLLM reported no spend, shown as a dash
// and never as $0 (Design System, LF1 D-LF1).
export const spend = (value: number | null | undefined) =>
  value === undefined ? HIDDEN_FIGURE : value === null ? "—" : formatUsd(value);
