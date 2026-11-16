import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { settingsTabsFor } from "@/lib/settings-tabs";
import {
  ADMIN,
  AUDITOR,
  ORG_ADMIN,
  PLAIN_VIEWER,
} from "@/test/fixtures/access-viewers";

import { SettingsTabs } from "./SettingsTabs";

// Source: Design System "Settings Page" (unit D, 2026-11-16): a tab row on the
// existing shadcn Tabs with the active tab taken from the route, each trigger a
// link (deep links, Back); a second row of Access sub-tabs under the Access
// tab; tabs the caller cannot use are not rendered. Module under test:
// `components/settings/SettingsTabs.tsx`
//   <SettingsTabs tabs={SettingsTab[]} />   ("use client"; reads usePathname)
// rendering a tablist named "Settings sections" and, only on an Access route,
// a tablist named "Access sections". Triggers are `role="tab"` links.
const pathname = vi.hoisted(() => ({
  current: "/dashboard/settings/accounts",
}));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));

beforeEach(() => {
  pathname.current = "/dashboard/settings/accounts";
});

const tabNames = (list: HTMLElement) =>
  within(list)
    .getAllByRole("tab")
    .map((t) => t.textContent?.trim());

describe("SettingsTabs", () => {
  it("renders only the tabs it is given, in order, as links to their routes", () => {
    render(<SettingsTabs tabs={settingsTabsFor(ORG_ADMIN)} />);
    const list = screen.getByRole("tablist", { name: "Settings sections" });
    expect(tabNames(list)).toEqual([
      "AWS accounts",
      "Sync and data",
      "LiteLLM",
      "Access",
    ]);
    expect(screen.getByRole("tab", { name: "Sync and data" })).toHaveAttribute(
      "href",
      "/dashboard/settings/sync",
    );
    expect(
      screen.queryByRole("tab", { name: "Audit" }),
    ).not.toBeInTheDocument();
  });

  it("renders just the registry and sync tabs for a viewer without a scope", () => {
    render(<SettingsTabs tabs={settingsTabsFor(PLAIN_VIEWER)} />);
    expect(
      tabNames(screen.getByRole("tablist", { name: "Settings sections" })),
    ).toEqual(["AWS accounts", "Sync and data"]);
  });

  it("marks the tab of the current route selected and no other", () => {
    pathname.current = "/dashboard/settings/sync";
    render(<SettingsTabs tabs={settingsTabsFor(ADMIN)} />);
    expect(screen.getByRole("tab", { name: "Sync and data" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    for (const name of ["AWS accounts", "LiteLLM", "Access", "Audit"]) {
      expect(screen.getByRole("tab", { name })).toHaveAttribute(
        "aria-selected",
        "false",
      );
    }
  });

  it("shows no sub-tab row outside the Access tab", () => {
    render(<SettingsTabs tabs={settingsTabsFor(ADMIN)} />);
    expect(
      screen.queryByRole("tablist", { name: "Access sections" }),
    ).not.toBeInTheDocument();
  });

  it("on an Access route selects Access and shows the sub-tab row with the current sub-tab selected", () => {
    pathname.current = "/dashboard/settings/access/roles";
    render(<SettingsTabs tabs={settingsTabsFor(ADMIN)} />);
    expect(screen.getByRole("tab", { name: "Access" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const sub = screen.getByRole("tablist", { name: "Access sections" });
    expect(tabNames(sub)).toEqual([
      "People",
      "Visibility",
      "Roles and mapping",
      "Identities",
      "Sign-in",
    ]);
    expect(
      within(sub).getByRole("tab", { name: "Roles and mapping" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      within(sub).getByRole("tab", { name: "Roles and mapping" }),
    ).toHaveAttribute("href", "/dashboard/settings/access/roles");
    expect(within(sub).getByRole("tab", { name: "People" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("renders only the Access sub-tabs the caller can use", () => {
    pathname.current = "/dashboard/settings/access/people";
    render(<SettingsTabs tabs={settingsTabsFor(AUDITOR)} />);
    expect(
      tabNames(screen.getByRole("tablist", { name: "Access sections" })),
    ).toEqual(["People", "Roles and mapping", "Identities", "Sign-in"]);
  });
  // Design System "Tabs vs secondary navigation" (~line 338): route tabs carry
  // aria-current="page" on the active link, on both rows. Review D round 1 B1.
  it("marks the active route tab and the active Access sub-tab aria-current=page, and no other", () => {
    pathname.current = "/dashboard/settings/access/roles";
    render(<SettingsTabs tabs={settingsTabsFor(ADMIN)} />);
    const main = screen.getByRole("tablist", { name: "Settings sections" });
    const sub = screen.getByRole("tablist", { name: "Access sections" });
    expect(within(main).getByRole("tab", { name: "Access" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      within(sub).getByRole("tab", { name: "Roles and mapping" }),
    ).toHaveAttribute("aria-current", "page");
    for (const name of ["AWS accounts", "Sync and data", "LiteLLM", "Audit"]) {
      expect(within(main).getByRole("tab", { name })).not.toHaveAttribute(
        "aria-current",
      );
    }
    expect(
      within(sub).getByRole("tab", { name: "People" }),
    ).not.toHaveAttribute("aria-current");
  });
});
