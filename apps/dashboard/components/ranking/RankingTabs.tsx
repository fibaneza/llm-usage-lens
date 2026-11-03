"use client";

import { RANKING_TABS, type RankingTab } from "@bedrock-usage/shared";
import type { KeyboardEvent, ReactNode } from "react";

import { cn } from "@/lib/utils";

const TAB_LABELS: Record<RankingTab, string> = {
  departments: "Departments",
  teams: "Teams",
  services: "Services",
  users: "Users",
};

const PANEL_ID = "ranking-tabpanel";
const tabId = (tab: RankingTab) => `ranking-tab-${tab}`;

type RankingTabsProps = {
  value: RankingTab;
  onChange: (tab: RankingTab) => void;
  children: ReactNode;
};

// Tabs with automatic activation (WAI-ARIA tabs pattern): arrow keys move focus
// and selection together, only the selected tab is in the tab order. All tabs
// control the single panel, whose content swaps with the selection. Below md the
// strip spans the column with tighter padding so all four tabs fit 375px without
// scrolling (Design System -- Anti-Patterns, Rule 40.6).
export function RankingTabs({ value, onChange, children }: RankingTabsProps) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = RANKING_TABS.indexOf(value);
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? RANKING_TABS.length - 1
          : step === undefined
            ? undefined
            : (index + step + RANKING_TABS.length) % RANKING_TABS.length;
    const nextTab = next === undefined ? undefined : RANKING_TABS[next];
    if (nextTab === undefined) return;

    event.preventDefault();
    onChange(nextTab);
    document.getElementById(tabId(nextTab))?.focus();
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label="Ranking by"
        onKeyDown={onKeyDown}
        className="border-border flex w-full border-b md:w-fit"
      >
        {RANKING_TABS.map((tab) => {
          const selected = tab === value;
          return (
            <button
              key={tab}
              id={tabId(tab)}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={PANEL_ID}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(tab)}
              className={cn(
                "focus-visible:ring-ring/50 -mb-px flex-auto border-b-2 px-2 py-2 text-sm font-medium whitespace-nowrap outline-none focus-visible:ring-[3px] md:flex-none md:px-4",
                selected
                  ? "border-primary text-foreground"
                  : "text-muted-foreground hover:text-foreground border-transparent",
              )}
            >
              {TAB_LABELS[tab]}
            </button>
          );
        })}
      </div>
      <div
        id={PANEL_ID}
        role="tabpanel"
        aria-labelledby={tabId(value)}
        className="flex min-w-0 flex-col gap-4"
      >
        {children}
      </div>
    </div>
  );
}
