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
import {
  isNavItemActive,
  PRIMARY_NAV_ITEMS,
  SETTINGS_NAV_ITEM,
} from "@/lib/nav";

// Active nav links render as a filled indigo pill (design reference). twMerge
// lets these override the primitive's default `sidebar-accent` active styling.
const NAV_LINK_CLASS =
  "h-9 rounded-lg font-medium data-[active=true]:bg-sidebar-primary data-[active=true]:text-sidebar-primary-foreground data-[active=true]:shadow-sm data-[active=true]:hover:bg-sidebar-primary data-[active=true]:hover:text-sidebar-primary-foreground";

export function AppSidebar() {
  const pathname = usePathname();
  const { state, toggleSidebar } = useSidebar();

  const SettingsIcon = SETTINGS_NAV_ITEM.icon;
  const collapsed = state === "collapsed";
  const CollapseIcon = collapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <Sidebar collapsible="icon" className="border-sidebar-border shadow-sm">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              asChild
              tooltip="Bedrock Cost"
              className="hover:bg-transparent active:bg-transparent"
            >
              <Link href="/dashboard">
                <div className="bg-primary text-primary-foreground flex aspect-square size-9 items-center justify-center rounded-lg">
                  <Gauge className="size-5" />
                </div>
                <div className="flex flex-col gap-0.5 leading-none">
                  <span className="font-semibold">Bedrock Cost</span>
                  <span className="text-primary text-[11px] font-medium tracking-wide uppercase">
                    {env.NEXT_PUBLIC_ORG_NAME}
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Main</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {PRIMARY_NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={isNavItemActive(pathname, item.href)}
                      tooltip={item.title}
                      className={NAV_LINK_CLASS}
                    >
                      <Link href={item.href}>
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
      </SidebarContent>

      <SidebarFooter className="border-sidebar-border border-t">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={isNavItemActive(pathname, SETTINGS_NAV_ITEM.href)}
              tooltip={SETTINGS_NAV_ITEM.title}
              className={NAV_LINK_CLASS}
            >
              <Link href={SETTINGS_NAV_ITEM.href}>
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
