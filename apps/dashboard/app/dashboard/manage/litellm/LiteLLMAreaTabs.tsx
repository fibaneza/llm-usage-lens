"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { LITELLM_AREA_TABS, liteLLMAreaTabHref } from "./litellm-area-tabs";

// Design System - Management pages, LiteLLM area: route tabs on the one Tabs
// component (Rule 40.9). Each trigger is a link, the active one comes from the
// pathname, so a tab is in the URL and Back steps across tabs.
export function LiteLLMAreaTabs() {
  const pathname = usePathname();
  const active = LITELLM_AREA_TABS.find((tab) => {
    const href = liteLLMAreaTabHref(tab.id);
    return pathname === href || pathname.startsWith(`${href}/`);
  });
  return (
    <Tabs value={active?.id ?? ""} className="min-w-0">
      <TabsList
        aria-label="LiteLLM sections"
        className="min-w-0 [scrollbar-width:thin] flex-nowrap overflow-x-auto"
      >
        {LITELLM_AREA_TABS.map((tab) => (
          <TabsTrigger
            key={tab.id}
            value={tab.id}
            aria-controls={undefined}
            className="shrink-0"
            asChild
          >
            <Link
              href={liteLLMAreaTabHref(tab.id)}
              aria-current={tab.id === active?.id ? "page" : undefined}
            >
              {tab.label}
            </Link>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
