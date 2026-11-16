import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { settingsTabsFor } from "@/lib/settings-tabs";
import { ADMIN, ORG_ADMIN } from "@/test/access-viewers";

import { SettingsHashResolver } from "./SettingsHashResolver";

// Source: Design System "Settings Page" - Hash compatibility (unit D,
// 2026-11-16); Access Control "Recent authentication" (the step-up returns
// `#role-grants` / `#password-users`). Module under test:
// `components/settings/SettingsHashResolver.tsx`
//   <SettingsHashResolver tabs={SettingsTab[]} />   ("use client", renders null)
// On mount it reads `window.location.hash`, resolves it with
// `resolveSettingsHash(hash, tabs)` and, when that route differs from the
// current pathname, calls `router.replace(<route>#<slug>)`. The pure mapping is
// covered in lib/settings-hash.test.ts; this file covers the browser wiring.
const replace = vi.fn();
const pathname = vi.hoisted(() => ({
  current: "/dashboard/settings/accounts",
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => pathname.current,
}));

function openWithHash(path: string, hash: string) {
  pathname.current = path;
  window.history.replaceState(null, "", `${path}${hash}`);
}

beforeEach(() => {
  replace.mockReset();
});
afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("SettingsHashResolver", () => {
  it.each([
    ["#role-grants", "/dashboard/settings/access/roles#role-grants"],
    ["#password-users", "/dashboard/settings/access/sign-in#password-users"],
    ["#audit-log", "/dashboard/settings/audit#audit-log"],
  ])("%s replaces the URL with its tab and sub-tab", (hash, target) => {
    openWithHash("/dashboard/settings/accounts", hash);
    render(<SettingsHashResolver tabs={settingsTabsFor(ADMIN)} />);
    expect(replace).toHaveBeenCalledWith(target);
  });

  it("does nothing without a hash", () => {
    openWithHash("/dashboard/settings/accounts", "");
    render(<SettingsHashResolver tabs={settingsTabsFor(ADMIN)} />);
    expect(replace).not.toHaveBeenCalled();
  });

  it("does nothing for an unknown hash", () => {
    openWithHash("/dashboard/settings/accounts", "#something-else");
    render(<SettingsHashResolver tabs={settingsTabsFor(ADMIN)} />);
    expect(replace).not.toHaveBeenCalled();
  });

  it("does nothing when the page is already on the resolved route", () => {
    openWithHash("/dashboard/settings/access/roles", "#role-grants");
    render(<SettingsHashResolver tabs={settingsTabsFor(ADMIN)} />);
    expect(replace).not.toHaveBeenCalled();
  });

  it("does nothing for a section whose tab the caller cannot use", () => {
    openWithHash("/dashboard/settings/accounts", "#role-grants");
    render(<SettingsHashResolver tabs={settingsTabsFor(ORG_ADMIN)} />);
    expect(replace).not.toHaveBeenCalled();
  });
});
