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
  audit: string[];
};

// The complete role matrix: security-relevant, so no row is sampled away
// (Rule 60.24a).
const MATRIX: Row[] = [
  {
    name: "internal-admin",
    viewer: ADMIN,
    tabs: ["accounts", "sync", "litellm", "access", "audit"],
    subTabs: ADMIN_SUB_TABS,
    audit: ["audit-log", "access-review"],
  },
  {
    name: "the master user (internal-admin by master sign-in)",
    viewer: MASTER,
    tabs: ["accounts", "sync", "litellm", "access", "audit"],
    subTabs: ADMIN_SUB_TABS,
    audit: ["audit-log", "access-review"],
  },
  {
    name: "internal-org-admin",
    viewer: ORG_ADMIN,
    tabs: ["accounts", "sync", "litellm", "access"],
    subTabs: [
      ["people", PEOPLE],
      ["visibility", ["visibility"]],
    ],
    audit: [],
  },
  {
    // D34: the auditor reads Pending and stale access but not Members,
    // Team admins or Visibility.
    name: "internal-auditor",
    viewer: AUDITOR,
    tabs: ["accounts", "sync", "litellm", "access", "audit"],
    subTabs: [
      ["people", ["pending-access"]],
      ["roles", ["group-mappings", "role-grants"]],
      ["identities", ["identity-links", "identity-mapping"]],
      ["sign-in", ["password-users", "per-user-approval"]],
    ],
    audit: ["audit-log", "access-review"],
  },
  {
    name: "a team-scope admin",
    viewer: TEAM_ADMIN,
    tabs: ["accounts", "sync", "access"],
    subTabs: [
      ["people", PEOPLE],
      ["visibility", ["visibility"]],
    ],
    audit: [],
  },
  {
    name: "a department-scope admin",
    viewer: DEPT_ADMIN,
    tabs: ["accounts", "sync", "access"],
    subTabs: [
      ["people", PEOPLE],
      ["visibility", ["visibility"]],
    ],
    audit: [],
  },
  {
    name: "a viewer without a scope",
    viewer: PLAIN_VIEWER,
    tabs: ["accounts", "sync"],
    subTabs: [],
    audit: [],
  },
  {
    // Fail closed: a session that builds no viewer still reads the registry
    // and sync status, as before the split.
    name: "no resolvable viewer",
    viewer: null,
    tabs: ["accounts", "sync"],
    subTabs: [],
    audit: [],
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

  it.each(MATRIX)("$name sees the Audit sections it may read", (row) => {
    const audit = settingsTabsFor(row.viewer).find((t) => t.id === "audit");
    expect([...(audit?.sections ?? [])]).toEqual(row.audit);
  });

  it("only the Access tab has sub-tabs", () => {
    for (const tab of settingsTabsFor(ADMIN)) {
      expect(tab.subTabs.length > 0).toBe(tab.id === "access");
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
      ["Audit", `${BASE}/audit`],
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
    expect(settingsTabsFor(grantOnly).map((t) => t.id)).toContain("audit");
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
