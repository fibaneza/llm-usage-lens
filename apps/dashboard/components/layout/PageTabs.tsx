"use client";

import type { ReactNode } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type PageTabsProps<T extends string> = {
  label: string;
  value: T;
  onValueChange: (value: T) => void;
  items: readonly { value: T; label: string; badge?: ReactNode }[];
  panelId?: string;
  children: ReactNode;
};

// Design System -- Component Inventory, `PageTabs`: peer views of one object
// over shadcn Tabs. The caller owns the URL state (nuqs), so the param name
// stays in its `lib/*-search-params.ts` module.
export function PageTabs<T extends string>({
  label,
  value,
  onValueChange,
  items,
  panelId,
  children,
}: PageTabsProps<T>) {
  return (
    <Tabs
      value={value}
      onValueChange={(next) => {
        const item = items.find((candidate) => candidate.value === next);
        if (item) onValueChange(item.value);
      }}
      className="gap-3"
    >
      <TabsList
        aria-label={label}
        className="h-9 [scrollbar-width:none] flex-nowrap gap-1 overflow-x-auto"
      >
        {items.map((item) => (
          <TabsTrigger
            key={item.value}
            value={item.value}
            {...(panelId ? { "aria-controls": panelId } : {})}
            className="focus-visible:ring-focus-ring focus-visible:ring-offset-background rounded-control max-md:min-h-touch h-9 gap-1.5 py-0 focus-visible:ring-offset-2"
          >
            {item.label}
            {item.badge}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value={value} id={panelId}>
        {children}
      </TabsContent>
    </Tabs>
  );
}
