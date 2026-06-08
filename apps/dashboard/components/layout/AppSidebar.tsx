"use client";

import { Gauge, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { env } from "@/env";
import { isNavItemActive, NAV_GROUPS, SETTINGS_NAV_ITEM } from "@/lib/nav";

// Active nav links render as a filled indigo pill (design reference). twMerge
// lets these override the primitive's default `sidebar-accent` active styling.
const NAV_LINK_CLASS =
  "h-9 rounded-lg font-medium data-[active=true]:bg-sidebar-primary data-[active=true]:text-sidebar-primary-foreground data-[active=true]:shadow-sm data-[active=true]:hover:bg-sidebar-primary data-[active=true]:hover:text-sidebar-primary-foreground";

export function AppSidebar() {
  const pathname = usePathname();
  const { state, toggleSidebar } = useSidebar();

  const collapsed = state === "collapsed";
  const CollapseIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const SettingsIcon = SETTINGS_NAV_ITEM.icon;
  const settingsActive = isNavItemActive(pathname, SETTINGS_NAV_ITEM.href);

  return (
    <Sidebar collapsible="icon" className="border-sidebar-border">
      {/* Brand lives at the top of the rail (design reference); the mark stays
          visible when the rail collapses to icon width, the wordmark hides. */}
      <SidebarHeader className="border-sidebar-border h-(--header-height) justify-center border-b">
        <Link
          href="/dashboard"
          className="flex items-center gap-2.5 px-1"
          aria-label="Bedrock Cost — go to overview"
        >
          <div className="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
            <Gauge className="size-5" />
          </div>
          <div className="flex flex-col gap-0.5 leading-none group-data-[collapsible=icon]:hidden">
            <span className="font-semibold">Bedrock Cost</span>
            <span className="text-primary text-[11px] font-medium tracking-wide uppercase">
              {env.NEXT_PUBLIC_ORG_NAME}
            </span>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        {NAV_GROUPS.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = isNavItemActive(pathname, item.href);
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        tooltip={item.title}
                        className={NAV_LINK_CLASS}
                      >
                        <Link
                          href={item.href}
                          aria-current={active ? "page" : undefined}
                        >
                          <Icon />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-sidebar-border border-t">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={settingsActive}
              tooltip={SETTINGS_NAV_ITEM.title}
              className={NAV_LINK_CLASS}
            >
              <Link
                href={SETTINGS_NAV_ITEM.href}
                aria-current={settingsActive ? "page" : undefined}
              >
                <SettingsIcon />
                <span>{SETTINGS_NAV_ITEM.title}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={toggleSidebar}
              tooltip={collapsed ? "Expand" : "Collapse"}
              className="h-9 rounded-lg"
            >
              <CollapseIcon />
              <span>Collapse</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
