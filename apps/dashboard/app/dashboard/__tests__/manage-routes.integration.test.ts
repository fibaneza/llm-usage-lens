import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  seedOrg,
  signInAs,
  type CallerName,
} from "@/test/fixtures/scope-fixtures";
import { clearTable, ensureTestTable } from "@/test/support/test-support";

import LiteLLMPage from "../litellm/page";
import AuditPage from "../manage/audit/page";
import LiteLLMAreaLayout from "../manage/litellm/layout";
import LiteLLMAreaIndexPage from "../manage/litellm/page";
import LiteLLMAreaTabPage from "../manage/litellm/[tab]/page";
import OrganisationPage from "../manage/organisation/page";
import TeamPage from "../manage/team/page";
import UsersManagePage from "../manage/users/page";
import SettingsAccessGroupPage from "../settings/access/[group]/page";
import SettingsAccessIndexPage from "../settings/access/page";
import SettingsAccountsPage from "../settings/accounts/page";
import SettingsLiteLLMSectionPage from "../settings/litellm/[section]/page";
import SettingsLiteLLMPage from "../settings/litellm/page";
import SettingsTeamLinksMovedPage from "../settings/litellm/team-links/page";
import SettingsUsersMovedPage from "../settings/litellm/users/page";
import SettingsIndexPage from "../settings/page";
import SettingsSyncPage from "../settings/sync/page";

// Source: Access Control - Navigation and landing by role (the matrix: Team
// for admin / org admin / auditor read-only / lead, Organisation and Users for
// the global readers, Audit for admin and auditor only, Settings for the global
// readers and closed to lead and user) and "Hidden means absent and 404 ... its
// route - and any redirect that lands on it - returns the same 404 body as a
// missing page (Enforcement item 2; Rule 10.3)"; Design System - Management
// pages, Settings Page; slice B2 brief B2-1 (the one capability function),
// B2-10 (`/dashboard/settings` and every tab route notFound() when `settings`
// is false: layout and each page), B2-3 (a redirect target the caller may not
// see 404s there). Security matrix, so it stays complete: every Management and
// Settings route x every caller class. Real policy inputs from DynamoDB Local
// (test/fixtures/scope-fixtures.ts org); only `@/auth`, the Next helpers and
// the client content components are stubbed. The page shells are Server
// Components, so calling them is the layer that sees the gate. The flags per
// caller are asserted in lib/manage-access.integration.test.ts; the Usage
// routes in usage-routes.integration.test.ts.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", async () => {
  const mod = await import("@/test/fakes/next-cache-fake");
  return mod.fakeNextCache;
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/app/dashboard/settings/step-up-actions", () => ({
  stepUpWithEntra: vi.fn(),
  stepUpWithCredentials: vi.fn(),
  stepUpWithDevLogin: vi.fn(),
}));
vi.mock("@/components/manage/TeamPageContent", () => ({
  TeamPageContent: () => null,
}));
vi.mock("@/components/manage/AuditPageContent", () => ({
  AuditPageContent: () => null,
}));
vi.mock("@/components/litellm/OrganisationSection", () => ({
  OrganisationSection: () => null,
}));
vi.mock("@/components/litellm/UserSearch", () => ({ UserSearch: () => null }));
vi.mock("@/components/litellm/LiteLLMSection", () => ({
  LiteLLMSection: () => null,
}));
vi.mock("@/components/settings/litellm-panel/LiteLLMTeamLinksSection", () => ({
  LiteLLMTeamLinksSection: () => null,
}));
vi.mock("@/components/settings/litellm-panel/LiteLLMUsersSection", () => ({
  LiteLLMUsersSection: () => null,
}));
vi.mock("@/components/settings/litellm-panel/LiteLLMConnectionSection", () => ({
  LiteLLMConnectionSection: () => null,
}));
vi.mock("@/components/settings/litellm-panel/LiteLLMGuardrailsSection", () => ({
  LiteLLMGuardrailsSection: () => null,
}));
vi.mock("@/components/settings/litellm-panel/LiteLLMGatewaySection", () => ({
  LiteLLMGatewaySection: () => null,
}));
vi.mock("@/components/settings/AccountsTab", () => ({
  AccountsTab: () => null,
}));
vi.mock("@/components/settings/SyncTab", () => ({ SyncTab: () => null }));
vi.mock("@/components/settings/access/AccessSections", () => ({
  AccessSections: () => null,
}));

beforeAll(ensureTestTable);
beforeEach(async () => {
  const { resetFakeCache } = await import("@/test/fakes/next-cache-fake");
  resetFakeCache();
  await clearTable();
  await seedOrg();
});

type Outcome = "not-found" | "rendered" | { redirectedTo: string };

async function outcomeOf(render: () => unknown): Promise<Outcome> {
  try {
    await render();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "NEXT_NOT_FOUND") return "not-found";
    if (message.startsWith("NEXT_REDIRECT:")) {
      return { redirectedTo: message.slice("NEXT_REDIRECT:".length) };
    }
    throw error;
  }
  return "rendered";
}

// A refused caller never gets the page and never a data redirect: the 404, or
// the sign-in redirect for a missing session (B1 precedent, usage-routes).
const refused = (o: Outcome) =>
  o === "not-found" || (typeof o === "object" && o.redirectedTo === "/sign-in");
const admitted = (o: Outcome) => !refused(o);

const ALL: CallerName[] = [
  "admin",
  "orgAdmin",
  "auditor",
  "teamAdminA",
  "deptAdminEng",
  "memberA",
  "memberB",
  "viewerNone",
];

type Route = {
  path: string;
  render: () => unknown;
  allowed: CallerName[];
};

const GLOBAL_READERS: CallerName[] = ["admin", "orgAdmin", "auditor"];
const LEADS: CallerName[] = ["teamAdminA", "deptAdminEng"];

const ROUTES: readonly Route[] = [
  {
    path: "/dashboard/manage/team",
    render: () => TeamPage({ searchParams: Promise.resolve({}) }),
    allowed: [...GLOBAL_READERS, ...LEADS],
  },
  // M1 (MI-D2, D2): the LiteLLM area - the layout, the index and each tab
  // page gate on the `litellm` flag (admin, org-admin, auditor); lead and
  // user get the 404 on every one, since a layout alone is not re-run on soft
  // navigation.
  {
    path: "/dashboard/manage/litellm (layout)",
    render: () => LiteLLMAreaLayout({ children: null }),
    allowed: GLOBAL_READERS,
  },
  {
    path: "/dashboard/manage/litellm",
    render: () => LiteLLMAreaIndexPage({ searchParams: Promise.resolve({}) }),
    allowed: GLOBAL_READERS,
  },
  ...(["organisation", "teams", "users"] as const).map(
    (tab): Route => ({
      path: `/dashboard/manage/litellm/${tab}`,
      render: () => LiteLLMAreaTabPage({ params: Promise.resolve({ tab }) }),
      allowed: GLOBAL_READERS,
    }),
  ),
  {
    path: "/dashboard/manage/litellm/nope",
    render: () =>
      LiteLLMAreaTabPage({ params: Promise.resolve({ tab: "nope" }) }),
    allowed: [],
  },
  {
    path: "/dashboard/manage/users",
    render: () => UsersManagePage(),
    allowed: GLOBAL_READERS,
  },
  // Neither audit source is readable by the org admin (Access Control, Audit
  // for org admin).
  {
    path: "/dashboard/manage/audit",
    render: () => AuditPage(),
    allowed: ["admin", "auditor"],
  },
  // B2-10: Settings and every tab route, closed to lead and user.
  {
    path: "/dashboard/settings",
    render: () => SettingsIndexPage(),
    allowed: GLOBAL_READERS,
  },
  {
    path: "/dashboard/settings/accounts",
    render: () => SettingsAccountsPage(),
    allowed: GLOBAL_READERS,
  },
  {
    path: "/dashboard/settings/sync",
    render: () => SettingsSyncPage(),
    allowed: GLOBAL_READERS,
  },
  {
    path: "/dashboard/settings/litellm",
    render: () => SettingsLiteLLMPage(),
    allowed: GLOBAL_READERS,
  },
  ...(["connection", "guardrails", "gateway"] as const).map(
    (section): Route => ({
      path: `/dashboard/settings/litellm/${section}`,
      render: () =>
        SettingsLiteLLMSectionPage({ params: Promise.resolve({ section }) }),
      allowed: GLOBAL_READERS,
    }),
  ),
  {
    path: "/dashboard/settings/access",
    render: () => SettingsAccessIndexPage(),
    allowed: GLOBAL_READERS,
  },
  {
    path: "/dashboard/settings/access/people",
    render: () =>
      SettingsAccessGroupPage({ params: Promise.resolve({ group: "people" }) }),
    allowed: GLOBAL_READERS,
  },
];

describe.each(ROUTES)("$path (B2 route gate)", ({ render, allowed }) => {
  const hidden = ALL.filter((name) => !allowed.includes(name));

  it.each(allowed)("admits %s", async (name) => {
    signInAs(name);
    expect(admitted(await outcomeOf(render))).toBe(true);
  });

  it.each(hidden)(
    "returns the not-found page for %s (hidden means absent)",
    async (name) => {
      signInAs(name);
      expect(await outcomeOf(render)).toBe("not-found");
    },
  );

  it("never renders for an unauthenticated caller", async () => {
    signInAs(null);
    expect(refused(await outcomeOf(render))).toBe(true);
  });
});

// B2-3 + Access Control (Hidden means absent): "any redirect that lands on it
// returns the same 404". The retired routes redirect for everyone; the target
// then applies its own gate. M1 (D3): every old URL, not only the LiteLLM tabs.
describe("redirect targets keep their gate (B2-3, M1 D3)", () => {
  const follow = async (url: string) => {
    const path = new URL(url, "http://localhost").pathname;
    const route = ROUTES.find((r) => r.path === path);
    if (!route) throw new Error(`no route for redirect target ${url}`);
    return outcomeOf(route.render);
  };
  const targetOf = async (render: () => unknown) => {
    const outcome = await outcomeOf(render);
    if (typeof outcome !== "object") throw new Error("expected a redirect");
    return outcome.redirectedTo;
  };
  const query = Promise.resolve({ dateFrom: "2026-10-01" });
  const litellmTab = (tab: string) =>
    targetOf(() => LiteLLMPage({ searchParams: Promise.resolve({ tab }) }));

  it.each([
    ["organisation", "teamAdminA"],
    ["users", "deptAdminEng"],
    ["audit", "orgAdmin"],
    ["team", "memberA"],
  ] as const)(
    "/dashboard/litellm?tab=%s lands on a 404 for %s",
    async (tab, name) => {
      signInAs(name);
      expect(await follow(await litellmTab(tab))).toBe("not-found");
    },
  );

  it("/dashboard/litellm?tab=team lands on the Team page for a lead", async () => {
    signInAs("teamAdminA");
    expect(admitted(await follow(await litellmTab("team")))).toBe(true);
  });

  const OLD_URLS: readonly [string, () => Promise<string>, string][] = [
    [
      "/dashboard/manage/organisation",
      () => targetOf(() => OrganisationPage({ searchParams: query })),
      "/dashboard/manage/litellm/organisation",
    ],
    [
      "/dashboard/litellm?tab=organisation",
      () => litellmTab("organisation"),
      "/dashboard/manage/litellm/organisation",
    ],
    [
      "/dashboard/settings/litellm/team-links",
      () => targetOf(() => SettingsTeamLinksMovedPage({ searchParams: query })),
      "/dashboard/manage/litellm/teams",
    ],
    [
      "/dashboard/settings/litellm/users",
      () => targetOf(() => SettingsUsersMovedPage({ searchParams: query })),
      "/dashboard/manage/litellm/users",
    ],
  ];

  describe.each(OLD_URLS)("%s", (_old, redirectOf, expected) => {
    it("redirects to the new area route for every caller", async () => {
      for (const name of ALL) {
        signInAs(name);
        const url = new URL(await redirectOf(), "http://localhost");
        expect(url.pathname).toBe(expected);
      }
    });

    it.each(GLOBAL_READERS)("lands on the page for %s", async (name) => {
      signInAs(name);
      expect(admitted(await follow(await redirectOf()))).toBe(true);
    });

    it.each(ALL.filter((n) => !GLOBAL_READERS.includes(n)))(
      "lands on a 404 for %s (hidden means absent)",
      async (name) => {
        signInAs(name);
        expect(await follow(await redirectOf())).toBe("not-found");
      },
    );
  });
});
