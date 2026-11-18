import { afterEach, describe, expect, it, vi } from "vitest";

import { litellmPanelCapabilities } from "@/lib/auth/litellm-panel";

import {
  ADMIN,
  AUDITOR,
  DEPT_ADMIN,
  ORG_ADMIN,
  PLAIN_VIEWER,
  TEAM_ADMIN,
} from "@/test/fixtures/access-viewers";

import { settingsTabsFor } from "./settings-tabs";

// Unit D rework after unit A1 (cec7e44): the LiteLLM tab follows
// `litellmPanelCapabilities(roles).visible` (lib/auth/litellm-panel.ts), not a
// role list of its own. The override lets a test prove the delegation.
const visibleOverride = vi.hoisted(() => ({ value: null as boolean | null }));
vi.mock("@/lib/auth/litellm-panel", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/auth/litellm-panel")>();
  return {
    ...actual,
    litellmPanelCapabilities: (roles: readonly string[]) => {
      const capabilities = actual.litellmPanelCapabilities(roles);
      return visibleOverride.value === null
        ? capabilities
        : { ...capabilities, visible: visibleOverride.value };
    },
  };
});
afterEach(() => {
  visibleOverride.value = null;
});

// Source: Design System "Settings Page" (unit D, 2026-11-16): the tab table
// (routes and "Visible to"), the Access sub-tab table (segments and section
// slugs), "a tab the caller cannot use is not rendered"; Access Control spec
// "Permission matrix" (via accessCapabilities); LiteLLM spec LD24 (the
// LiteLLM tab is for admin, org-admin and auditor). Rule 10.3 / 50.3: roles
// are resolved on the server; this pure function is the one place the tab set
// is decided. Module under test: `lib/settings-tabs.ts`
//   settingsTabsFor(viewer: { roles; adminScopes } | null | undefined): SettingsTab[]
// returning the visible tabs in table order; the Access tab carries its
// visible `subTabs`; `sections` lists the visible access section slugs of a
// sub-tab (and of the Audit tab).
const BASE = "/dashboard/settings";
const MASTER = { ...ADMIN, authMethod: "master" as const };

const PEOPLE = ["members", "team-admins", "pending-access"];
const ADMIN_SUB_TABS = [
  ["people", PEOPLE],
  ["visibility", ["visibility"]],
  ["roles", ["group-mappings", "role-grants"]],
  ["identities", ["identity-links", "identity-mapping"]],
  ["sign-in", ["password-users", "per-user-approval"]],
] as const;

type Row = {
  name: string;
  viewer: Parameters<typeof settingsTabsFor>[0];
  tabs: string[];
  subTabs: readonly (readonly [string, readonly string[]])[];
};

// The complete role matrix: security-relevant, so no row is sampled away
// (Rule 60.24a).
const MATRIX: Row[] = [
  {
    name: "internal-admin",
    viewer: ADMIN,
    tabs: ["accounts", "sync", "litellm", "access"],
    subTabs: ADMIN_SUB_TABS,
  },
  {
    name: "the master user (internal-admin by master sign-in)",
    viewer: MASTER,
    tabs: ["accounts", "sync", "litellm", "access"],
    subTabs: ADMIN_SUB_TABS,
  },
  {
    name: "internal-org-admin",
    viewer: ORG_ADMIN,
    tabs: ["accounts", "sync", "litellm", "access"],
    subTabs: [
      ["people", PEOPLE],
      ["visibility", ["visibility"]],
    ],
  },
  {
    // D34: the auditor reads Pending and stale access but not Members,
    // Team admins or Visibility.
    name: "internal-auditor",
    viewer: AUDITOR,
    tabs: ["accounts", "sync", "litellm", "access"],
    subTabs: [
      ["people", ["pending-access"]],
      ["roles", ["group-mappings", "role-grants"]],
      ["identities", ["identity-links", "identity-mapping"]],
      ["sign-in", ["password-users", "per-user-approval"]],
    ],
  },
  {
    name: "a team-scope admin",
    viewer: TEAM_ADMIN,
    tabs: ["accounts", "sync", "access"],
    subTabs: [
      ["people", PEOPLE],
      ["visibility", ["visibility"]],
    ],
  },
  {
    name: "a department-scope admin",
    viewer: DEPT_ADMIN,
    tabs: ["accounts", "sync", "access"],
    subTabs: [
      ["people", PEOPLE],
      ["visibility", ["visibility"]],
    ],
  },
  {
    name: "a viewer without a scope",
    viewer: PLAIN_VIEWER,
    tabs: ["accounts", "sync"],
    subTabs: [],
  },
  {
    // Fail closed: a session that builds no viewer still reads the registry
    // and sync status, as before the split.
    name: "no resolvable viewer",
    viewer: null,
    tabs: ["accounts", "sync"],
    subTabs: [],
  },
];

describe("settingsTabsFor - role matrix", () => {
  it.each(MATRIX)("$name sees exactly its tabs, in order", (row) => {
    expect(settingsTabsFor(row.viewer).map((t) => t.id)).toEqual(row.tabs);
  });

  it.each(MATRIX)(
    "$name sees exactly its Access sub-tabs and their sections",
    (row) => {
      const access = settingsTabsFor(row.viewer).find((t) => t.id === "access");
      expect(
        (access?.subTabs ?? []).map((s) => [s.id, [...s.sections]]),
      ).toEqual(row.subTabs.map(([id, sections]) => [id, [...sections]]));
    },
  );

  // B2-3 / Design System - Settings Page: the Audit log and Access review live
  // on Management -> Audit; the Settings tab row has no Audit tab for anyone
  // (a stored role grant included), and no tab carries audit sections.
  it.each(MATRIX)("$name is offered no Audit tab (B2-3)", (row) => {
    const tabs = settingsTabsFor(row.viewer);
    expect(tabs.map((t) => t.id)).not.toContain("audit");
    expect(tabs.flatMap((t) => [...t.sections])).toEqual([]);
    expect(tabs.map((t) => t.href)).not.toContain(`${BASE}/audit`);
  });

  // Unit A2 (Design System "Settings Page", LiteLLM sub-tabs): the LiteLLM
  // tab joins Access as the second tab with a second row.
  it("only the Access and LiteLLM tabs have sub-tabs", () => {
    for (const tab of settingsTabsFor(ADMIN)) {
      expect(tab.subTabs.length > 0).toBe(
        tab.id === "access" || tab.id === "litellm",
      );
    }
  });
});

describe("settingsTabsFor - labels and routes", () => {
  it("names and routes every tab per the Settings Page table", () => {
    expect(settingsTabsFor(ADMIN).map((t) => [t.label, t.href])).toEqual([
      ["AWS accounts", `${BASE}/accounts`],
      ["Sync and data", `${BASE}/sync`],
      ["LiteLLM", `${BASE}/litellm`],
      ["Access", `${BASE}/access`],
    ]);
  });

  it("names and routes every Access sub-tab as a route segment", () => {
    const access = settingsTabsFor(ADMIN).find((t) => t.id === "access");
    expect(access?.subTabs.map((s) => [s.label, s.href])).toEqual([
      ["People", `${BASE}/access/people`],
      ["Visibility", `${BASE}/access/visibility`],
      ["Roles and mapping", `${BASE}/access/roles`],
      ["Identities", `${BASE}/access/identities`],
      ["Sign-in", `${BASE}/access/sign-in`],
    ]);
  });

  it("effective roles decide: a stored role grant counts like a claim", () => {
    const grantOnly = {
      roles: ["internal-viewer", "internal-auditor"],
      adminScopes: [],
    };
    expect(settingsTabsFor(grantOnly).map((t) => t.id)).toContain("litellm");
  });
});

// Contract (unit D rework, Design System "Settings Page" + LiteLLM spec LD24):
// the tab is in the set exactly when litellmPanelCapabilities(roles).visible.
describe("settingsTabsFor - LiteLLM tab follows litellmPanelCapabilities", () => {
  const ROLE_SETS: readonly (readonly string[])[] = [
    [],
    ["internal-admin"],
    ["internal-org-admin"],
    ["internal-auditor"],
    ["internal-viewer"],
    ["internal-viewer", "internal-auditor"],
    ["internal-viewer", "internal-org-admin"],
    ["Admin"],
    ["unknown-role"],
  ];

  it.each(ROLE_SETS.map((roles) => [roles.join(",") || "(none)", roles]))(
    "roles [%s]: the tab is present iff the panel is visible",
    (_name, roles) => {
      const ids = settingsTabsFor({ roles, adminScopes: [] }).map((t) => t.id);
      expect(ids.includes("litellm")).toBe(
        litellmPanelCapabilities(roles).visible,
      );
    },
  );

  it("shows the tab when the capabilities say visible, whatever the role", () => {
    visibleOverride.value = true;
    expect(settingsTabsFor(PLAIN_VIEWER).map((t) => t.id)).toContain("litellm");
  });

  it("hides the tab when the capabilities say not visible, whatever the role", () => {
    visibleOverride.value = false;
    expect(settingsTabsFor(ADMIN).map((t) => t.id)).not.toContain("litellm");
  });
});

// Unit A2. Source: Design System "Settings Page" - LiteLLM sub-tabs (D-A2-1,
// D-A2-3): the LiteLLM tab carries the three sub-tabs as route segments, in
// order, for exactly the roles whose litellmPanelCapabilities(...).visible is
// true (LD24: admin, org-admin, auditor); no other role has the tab at all, so
// its sub-tab URLs are the same 404. Security matrix: complete (Rule 60.24a).
describe("settingsTabsFor - LiteLLM sub-tabs (unit A2)", () => {
  const SUB = [
    ["connection", "Connection", `${BASE}/litellm/connection`],
    ["guardrails", "Guardrails", `${BASE}/litellm/guardrails`],
    // L6 (Design System "Settings Page", 2026-11-17): Gateway is the fifth,
    // last sub-tab, for the same three roles.
    ["gateway", "Gateway", `${BASE}/litellm/gateway`],
  ];
  const litellmSubTabs = (viewer: Parameters<typeof settingsTabsFor>[0]) =>
    settingsTabsFor(viewer)
      .find((t) => t.id === "litellm")
      ?.subTabs.map((s) => [s.id, s.label, s.href]);

  it.each([
    ["internal-admin", ADMIN],
    ["the master user", MASTER],
    ["internal-org-admin", ORG_ADMIN],
    ["internal-auditor", AUDITOR],
  ] as const)(
    "%s sees Connection, Guardrails and Gateway only, in order, as routes (M1 D3: Team links and Users moved to Management -> LiteLLM)",
    (_name, viewer) => {
      expect(litellmSubTabs(viewer)).toEqual(SUB);
      const ids = (litellmSubTabs(viewer) ?? []).map(([id]) => id);
      expect(ids).not.toContain("team-links");
      expect(ids).not.toContain("users");
    },
  );

  it.each([
    ["a team-scope admin", TEAM_ADMIN],
    ["a department-scope admin", DEPT_ADMIN],
    ["a viewer without a scope", PLAIN_VIEWER],
    ["no resolvable viewer", null],
    ["legacy Admin", { roles: ["Admin"], adminScopes: [] }],
  ] as const)("%s has no LiteLLM tab and so no sub-tabs", (_name, viewer) => {
    expect(litellmSubTabs(viewer)).toBeUndefined();
  });
});
