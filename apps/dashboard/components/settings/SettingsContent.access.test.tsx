import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NEVER_SYNCED } from "@/test/api-stubs";
import { ORG_ROUTES, ok, page, stubAccessApi } from "@/test/access-ui-stubs";
import { ADMIN, AUDITOR, PLAIN_VIEWER } from "@/test/access-viewers";
import { renderWithProviders } from "@/test/render-providers";

import type { StepUpActions } from "./access/types";
import { SettingsContent } from "./SettingsContent";

// Source: implementation-phases Phase 4R.4 ("Settings access sections"),
// design-system "Settings Page" (Access: sections a caller cannot use are not
// rendered), Rule 10.3 / 50.3 (roles are resolved on the server and passed
// down). Module under test: `components/settings/SettingsContent.tsx`, which
// gains an OPTIONAL prop
//   access?: { viewer: AccessViewer; stepUp: StepUpActions }
// When present it renders `<AccessSections viewer stepUp />` after the existing
// sections; when absent (existing callers and tests) nothing changes.
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const stepUp: StepUpActions = {
  entra: async () => undefined,
  credentials: async () => undefined,
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
    "GET /api/audit": page([]),
    "GET /api/litellm/connection": () => ok({}),
  });
}

describe("SettingsContent - access sections", () => {
  it("renders the access sections for an admin below the existing ones", async () => {
    stubAll();
    renderWithProviders(
      <SettingsContent isAdmin access={{ viewer: ADMIN, stepUp }} />,
    );
    expect(
      await screen.findByRole("heading", { level: 2, name: "Role grants" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /account registry/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /data retention/i }),
    ).toBeInTheDocument();
  });

  it("renders only the read-only sections for an auditor", async () => {
    stubAll();
    renderWithProviders(
      <SettingsContent isAdmin={false} access={{ viewer: AUDITOR, stepUp }} />,
    );
    expect(
      await screen.findByRole("heading", { level: 2, name: "Audit log" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { level: 2, name: "Members" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /add account/i }),
    ).not.toBeInTheDocument();
  });

  it("renders no access heading for a plain viewer", async () => {
    stubAll();
    renderWithProviders(
      <SettingsContent
        isAdmin={false}
        access={{ viewer: PLAIN_VIEWER, stepUp }}
      />,
    );
    await screen.findByRole("heading", { name: /data retention/i });
    for (const name of ["Members", "Role grants", "Audit log"]) {
      expect(
        screen.queryByRole("heading", { level: 2, name }),
      ).not.toBeInTheDocument();
    }
  });

  it("is unchanged when no access prop is passed", async () => {
    stubAll();
    renderWithProviders(<SettingsContent isAdmin={false} />);
    await screen.findByRole("heading", { name: /data retention/i });
    expect(
      screen.queryByRole("heading", { level: 2, name: "Role grants" }),
    ).not.toBeInTheDocument();
  });
});
