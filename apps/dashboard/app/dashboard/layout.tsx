import { trace } from "@opentelemetry/api";
import { type CSSProperties, type ReactNode, Suspense } from "react";

import { auth } from "@/auth";
import { AppHeader } from "@/components/layout/AppHeader";
import { AppSidebar, AppSidebarFallback } from "@/components/layout/AppSidebar";
import { DefaultPresetProvider } from "@/components/providers/DefaultPresetProvider";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { env } from "@/env";
import { scopeFor } from "@/lib/api/scoped-rollups";
import { getAppConfig } from "@/lib/config/app-config";
import {
  resolveDefaultDateRange,
  resolveOrgName,
} from "@/lib/config/resolvers";
import { managementAccessFor } from "@/lib/manage-access";
import type { NavScope } from "@/lib/nav";

// Shell: a collapsible sidebar (brand + grouped nav) beside the content inset.
// The inset opens with its own top bar (page title + sync status, account
// actions); the content container fills the inset with no page-level
// max-width and gutters of 16 / 24 / 32px (Design System — Layout: Structure).
// The 1440 breakpoint is written in rem (min-[90rem]) so it sorts after the
// rem-based lg: utilities in the compiled CSS. --header-height aligns the
// sidebar's brand header with the inset's top bar. Every dashboard page renders
// here.
async function navScopeOrUndefined(): Promise<NavScope | undefined> {
  try {
    const session = await auth();
    if (!session) return undefined;
    const full = await scopeFor(session, []);
    const access = await managementAccessFor(session);
    // Only the nav fields cross to the client: usage keys and visibility stay
    // on the server. Management and Settings follow the one capability
    // function (slice B2, B2-1); Audit shows when either source is readable.
    return {
      global: full.global,
      memberTeamId: full.memberTeamId,
      teamScopes: full.teamScopes,
      departmentScopes: full.departmentScopes,
      management: {
        team: access.team,
        organisation: access.organisation,
        users: access.users,
        audit: access.audit.app || access.audit.gateway,
        settings: access.settings,
      },
    };
  } catch (error) {
    trace
      .getActiveSpan()
      ?.recordException(
        error instanceof Error ? error : new Error("nav scope read failed"),
      );
    return {
      global: false,
      memberTeamId: null,
      teamScopes: new Set<string>(),
      departmentScopes: new Set<string>(),
      management: {
        team: false,
        organisation: false,
        users: false,
        audit: false,
        settings: false,
      },
    };
  }
}

export default async function DashboardLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  // The sidebar lists only the caller's destinations (Phase 4R.5). The scope
  // is read per request from the stored authorization data (Rule 60.10). If
  // the read fails the shell fails closed on authorization: it renders the
  // no-team rail rather than the bare one (Rules 40.4, 60.12), every page
  // still enforces access itself, and the error is recorded on the active
  // span (Rule 60.17).
  const scope = await navScopeOrUndefined();
  // Resolved from config.yaml on the server and passed down (System
  // Architecture — Configuration file, A10, A11).
  const config = getAppConfig();
  const orgName = resolveOrgName(config, env.NEXT_PUBLIC_ORG_NAME).value;
  const defaultPreset = resolveDefaultDateRange(config).value;
  return (
    <DefaultPresetProvider preset={defaultPreset}>
      <SidebarProvider style={{ "--header-height": "3.5rem" } as CSSProperties}>
        {/* AppSidebar reads the URL via useSearchParams (issue #75 — carries the
          date range onto nav links), so it sits under Suspense for static
          prerender (Rule 60.12); the fallback is the same rail with bare hrefs. */}
        <Suspense
          fallback={<AppSidebarFallback scope={scope} orgName={orgName} />}
        >
          <AppSidebar scope={scope} orgName={orgName} />
        </Suspense>
        <SidebarInset className="min-w-0">
          <AppHeader scope={scope} />
          <div className="w-full flex-1 p-4 md:p-6 min-[90rem]:p-8">
            {children}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </DefaultPresetProvider>
  );
}
