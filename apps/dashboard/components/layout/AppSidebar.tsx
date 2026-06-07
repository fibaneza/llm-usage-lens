"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
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

  const collapsed = state === "collapsed";
  const CollapseIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const SettingsIcon = SETTINGS_NAV_ITEM.icon;
  const settingsActive = isNavItemActive(pathname, SETTINGS_NAV_ITEM.href);

  return (
    // Offset below the full-width header via the shared --header-height var; the
    // brand lives in the header, so the sidebar starts directly with the nav.
    <Sidebar
      collapsible="icon"
      className="border-sidebar-border top-(--header-height) h-[calc(100svh-var(--header-height))] shadow-sm"
    >
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Main</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {PRIMARY_NAV_ITEMS.map((item) => {
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
