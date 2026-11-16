import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { settingsTabsFor } from "@/lib/settings-tabs";
import type { AccessSectionSlug } from "@/lib/settings-tabs";
import { NEVER_SYNCED } from "@/test/fakes/api-stubs";
import {
  ORG_ROUTES,
  ok,
  page,
  stubAccessApi,
} from "@/test/fakes/access-ui-stubs";
import {
  ADMIN,
  AUDITOR,
  ORG_ADMIN,
  PLAIN_VIEWER,
} from "@/test/fixtures/access-viewers";
import { renderWithProviders } from "@/test/support/render-providers";

import { AccessSections } from "./access/AccessSections";
import type { AccessViewer, StepUpActions } from "./access/types";

// Source: Design System "Settings Page" (unit D, 2026-11-16: the access
// sections are split over the Access sub-tabs and the Audit tab; "a section a
// caller cannot use is not rendered, and fetches nothing"); implementation-
// phases Phase 4R.4 and Rule 10.3 / 50.3 (roles resolved on the server and
// passed down). This file REPLACES SettingsContent.access.test.tsx: every
// per-role visibility assertion is kept, but asserted per tab by rendering
// `<AccessSections viewer stepUp sections={tab.sections} />` for each sub-tab /
// the Audit tab that `settingsTabsFor(viewer)` returns (the same call the
// pages make). Migrations:
//   - "admin sees the access sections (Role grants) below the existing ones":
//     each admin sub-tab renders its own headings (here); Account registry /
//     Data retention headings live in AccountsTab.test.tsx / SyncTab.test.tsx.
//   - "auditor sees only the read-only sections, no Members, no Add account":
//     the auditor rows below (Audit log on the Audit tab, only Pending and
//     stale on People); no Add account in AccountsTab.test.tsx.
//   - "plain viewer sees no access heading": the last test below plus the empty
//     tab set in lib/settings-tabs.test.ts.
//   - "unchanged when no access prop": obsolete (there is no combined page).
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const stepUp: StepUpActions = {
  entra: async () => undefined,
  credentials: async () => undefined,
  devLogin: async () => undefined,
};

const HEADINGS: Record<string, string> = {
  members: "Members",
  "team-admins": "Team admins",
  "pending-access": "Pending and stale access",
  visibility: "Visibility",
  "group-mappings": "Group mappings",
  "role-grants": "Role grants",
  "identity-links": "Identity links",
  "identity-mapping": "Identity mapping",
  "password-users": "Password users",
  "per-user-approval": "Per-user approval",
  "audit-log": "Audit log",
  "access-review": "Access review",
};

function stubAll() {
  return stubAccessApi({
    ...ORG_ROUTES,
    "GET /api/accounts": [],
    "GET /api/sync-status": NEVER_SYNCED,
    "GET /api/teams/team-pay/members": page([]),
    "GET /api/group-mappings": page([]),
    "GET /api/role-grants": page([]),
    "GET /api/password-users": page([]),
    "GET /api/governance/password-sign-in": { enabled: true, version: 0 },
    "GET /api/governance/per-user-approval": { approved: false },
    "GET /api/governance/identity-map-rules": { rules: [], version: 0 },
    "GET /api/governance/identity-map-rules/suggestions": { items: [] },
    "GET /api/audit": page([]),
    "GET /api/litellm/connection": () => ok({}),
  });
}

type Group = { id: string; sections: readonly AccessSectionSlug[] };

// One group per Access sub-tab plus the Audit tab: what each page renders.
function groupsOf(viewer: AccessViewer): Group[] {
  const tabs = settingsTabsFor(viewer);
  const access = tabs.find((t) => t.id === "access");
  const audit = tabs.find((t) => t.id === "audit");
  return [
    ...(access?.subTabs ?? []).map((s) => ({ id: s.id, sections: s.sections })),
    ...(audit ? [{ id: audit.id, sections: audit.sections }] : []),
  ];
}

describe("access sections per tab", () => {
  it.each([
    ["internal-admin", ADMIN, "Role grants", "roles"],
    ["internal-auditor", AUDITOR, "Audit log", "audit"],
  ] as const)(
    "%s: the tab that owns %s renders it",
    async (_name, viewer, heading, tabId) => {
      stubAll();
      const group = groupsOf(viewer).find((g) => g.id === tabId);
      expect(group).toBeDefined();
      renderWithProviders(
        <AccessSections
          viewer={viewer}
          stepUp={stepUp}
          sections={group?.sections}
        />,
      );
      expect(
        await screen.findByRole("heading", { level: 2, name: heading }),
      ).toBeInTheDocument();
    },
  );

  it.each([
    ["internal-admin", ADMIN],
    ["internal-org-admin", ORG_ADMIN],
    ["internal-auditor", AUDITOR],
  ] as const)(
    "%s: each tab renders exactly its own sections and no other tab's",
    async (_name, viewer) => {
      for (const group of groupsOf(viewer)) {
        stubAll();
        const { unmount } = renderWithProviders(
          <AccessSections
            viewer={viewer}
            stepUp={stepUp}
            sections={group.sections}
          />,
        );
        for (const slug of group.sections) {
          expect(
            await screen.findByRole("heading", {
              level: 2,
              name: HEADINGS[slug],
            }),
          ).toBeInTheDocument();
        }
        const mine = new Set<string>(group.sections);
        for (const [slug, name] of Object.entries(HEADINGS)) {
          if (mine.has(slug)) continue;
          expect(
            screen.queryByRole("heading", { level: 2, name }),
          ).not.toBeInTheDocument();
        }
        unmount();
        vi.unstubAllGlobals();
      }
    },
  );

  it("the auditor's People tab holds Pending and stale access only: no Members", async () => {
    stubAll();
    const people = groupsOf(AUDITOR).find((g) => g.id === "people");
    renderWithProviders(
      <AccessSections
        viewer={AUDITOR}
        stepUp={stepUp}
        sections={people?.sections}
      />,
    );
    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "Pending and stale access",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { level: 2, name: "Members" }),
    ).not.toBeInTheDocument();
  });

  it("a viewer without a scope has no tab with an access heading", async () => {
    const api = stubAll();
    expect(groupsOf(PLAIN_VIEWER)).toEqual([]);
    renderWithProviders(
      <AccessSections
        viewer={PLAIN_VIEWER}
        stepUp={stepUp}
        sections={Object.keys(HEADINGS) as AccessSectionSlug[]}
      />,
    );
    expect(api.calls).toEqual([]);
    for (const name of ["Members", "Role grants", "Audit log"]) {
      expect(
        screen.queryByRole("heading", { level: 2, name }),
      ).not.toBeInTheDocument();
    }
  });
});
