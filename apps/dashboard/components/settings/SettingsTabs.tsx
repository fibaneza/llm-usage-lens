"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { SettingsTab } from "@/lib/settings-tabs";

// Source: Design System "Settings Page" (unit D, 2026-11-16): tabs are routes;
// the active tab comes from the pathname and each trigger is a link. The row
// scrolls horizontally on 375 and never scrolls the page. `aria-controls` is
// cleared because the panel is the routed page, not a TabsContent.
const ROW = "min-w-0 flex-nowrap overflow-x-auto [scrollbar-width:thin]";

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function TabRow({
  label,
  items,
  pathname,
}: {
  label: string;
  items: readonly { id: string; label: string; href: string }[];
  pathname: string;
}) {
  const active = items.find((item) => isActive(pathname, item.href));
  return (
    <Tabs value={active?.id ?? ""} className="min-w-0">
      <TabsList aria-label={label} className={ROW}>
        {items.map((item) => (
          <TabsTrigger
            key={item.id}
            value={item.id}
            aria-controls={undefined}
            className="shrink-0"
            asChild
          >
            <Link
              href={item.href}
              aria-current={item.id === active?.id ? "page" : undefined}
            >
              {item.label}
            </Link>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

export function SettingsTabs({ tabs }: { tabs: readonly SettingsTab[] }) {
  const pathname = usePathname();
  const access = tabs.find(
    (t) => t.id === "access" && isActive(pathname, t.href),
  );
  const litellm = tabs.find(
    (t) => t.id === "litellm" && isActive(pathname, t.href),
  );
  return (
    <div className="flex flex-col gap-4">
      <TabRow label="Settings sections" items={tabs} pathname={pathname} />
      {access && access.subTabs.length > 0 ? (
        <TabRow
          label="Access sections"
          items={access.subTabs}
          pathname={pathname}
        />
      ) : null}
      {litellm && litellm.subTabs.length > 0 ? (
        <TabRow
          label="LiteLLM sections"
          items={litellm.subTabs}
          pathname={pathname}
        />
      ) : null}
    </div>
  );
}
