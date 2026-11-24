import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Source: Design System - Management pages, LiteLLM area (M1, D2, D3, D4):
// the tab is the route segment (organisation | teams | users); an unknown one
// is the missing-page 404; a caller without the `litellm` flag gets the same
// 404 (Access Control MI-D2, hidden means absent; Rule 10.3, authorized per
// request, Rule 60.10). Organisation keeps its content ("unchanged in
// content"); LiteLLM teams shows the team links - editable by internal-admin
// and internal-org-admin, read-only for the auditor (LiteLLM spec LD24) - with
// "New LiteLLM team" (canCreateTeam) for internal-admin only; LiteLLM users
// mounts the users section. Section behaviour lives in the section tests
// (Rule 60.24a); the caller x tab matrix against real policy inputs in
// __tests__/manage-routes.integration.test.ts.
const auth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => auth() }));
const loadViewer = vi.fn();
vi.mock("@/lib/auth/settings-access", () => ({
  loadSettingsAccessViewer: (session: unknown) => loadViewer(session),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/manage-access", async () => {
  const mod = await import("@/test/fakes/manage-access-fake");
  return mod.fakeManageAccess;
});
vi.mock("@/components/litellm/LiteLLMSection", () => ({
  LiteLLMSection: ({
    title,
    reported,
    children,
  }: {
    title: string;
    reported?: boolean;
    children: React.ReactNode;
  }) => (
    <section aria-label={title} data-reported={String(reported === true)}>
      {children}
    </section>
  ),
}));
vi.mock("@/components/litellm/OrganisationSection", () => ({
  OrganisationSection: () => <div data-testid="organisation" />,
}));
vi.mock("@/components/settings/litellm-panel/LiteLLMTeamLinksSection", () => ({
  LiteLLMTeamLinksSection: (props: {
    canEdit?: boolean;
    canCreateTeam?: boolean;
  }) => (
    <div data-testid="teams">
      {`${String(props.canEdit)}/${String(props.canCreateTeam)}`}
    </div>
  ),
}));
vi.mock("@/components/settings/litellm-panel/LiteLLMUsersSection", () => ({
  LiteLLMUsersSection: (props: { canReset?: boolean }) => (
    <div data-testid="users">{String(props.canReset)}</div>
  ),
}));

import {
  resetManageAccess,
  setManageAccess,
} from "@/test/fakes/manage-access-fake";

import LiteLLMAreaTabPage from "./page";

afterEach(() => {
  vi.clearAllMocks();
  resetManageAccess();
});

function as(roles: string[]) {
  auth.mockResolvedValue({ user: { oid: "oid-1", roles } });
  loadViewer.mockResolvedValue({ roles, authMethod: "entra", adminScopes: [] });
}
const open = (tab: string) =>
  LiteLLMAreaTabPage({ params: Promise.resolve({ tab }) });

describe("LiteLLM area tab page (M1)", () => {
  it("Organisation renders the Organisation section under the LiteLLM-reported label", async () => {
    as(["internal-admin"]);
    render(await open("organisation"));
    const region = screen.getByRole("region", { name: "Organisation" });
    expect(region).toHaveAttribute("data-reported", "true");
    expect(screen.getByTestId("organisation")).toBeInTheDocument();
    expect(screen.queryByTestId("teams")).not.toBeInTheDocument();
    expect(screen.queryByTestId("users")).not.toBeInTheDocument();
  });

  it("LiteLLM users mounts the users section", async () => {
    as(["internal-auditor"]);
    render(await open("users"));
    expect(
      screen.getByRole("region", { name: "LiteLLM users" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("users")).toBeInTheDocument();
    expect(screen.queryByTestId("teams")).not.toBeInTheDocument();
  });

  // LD24 / D4: team links Admin + org-admin; New LiteLLM team Admin only;
  // auditor read-only. Complete role matrix (security).
  it.each([
    ["internal-admin", "true/true"],
    ["internal-org-admin", "true/false"],
    ["internal-auditor", "false/false"],
  ])(
    "LiteLLM teams for %s passes canEdit/canCreateTeam = %s",
    async (role, flags) => {
      as([role]);
      render(await open("teams"));
      expect(
        screen.getByRole("region", { name: "LiteLLM teams" }),
      ).toBeInTheDocument();
      expect(screen.getByTestId("teams")).toHaveTextContent(flags);
    },
  );

  // LF1 F1 (Design System - LiteLLM users tab; RS2): the users tab gets the same
  // server capability as the teams table's canEdit (admin and org-admin true,
  // auditor false) as `canReset`, for Reset spend on proxy-team members.
  it.each([
    ["internal-admin", "true"],
    ["internal-org-admin", "true"],
    ["internal-auditor", "false"],
  ])("LiteLLM users for %s passes canReset = %s", async (role, flag) => {
    as([role]);
    render(await open("users"));
    expect(screen.getByTestId("users")).toHaveTextContent(flag);
  });

  it.each(["organisation", "teams", "users"])(
    "a caller without the litellm flag (a lead, a user) gets the 404 on %s",
    async (tab) => {
      setManageAccess({ litellm: false });
      as(["internal-viewer"]);
      await expect(open(tab)).rejects.toThrow("NEXT_NOT_FOUND");
      expect(screen.queryByRole("region")).not.toBeInTheDocument();
    },
  );

  it.each(["nope", "constructor", "Organisation", "teams/x", "team-links", ""])(
    "an unknown tab %j is the 404, even for an admin",
    async (tab) => {
      as(["internal-admin"]);
      await expect(open(tab)).rejects.toThrow("NEXT_NOT_FOUND");
    },
  );

  it("the teams tab is the 404 when the session builds no viewer", async () => {
    auth.mockResolvedValue(null);
    loadViewer.mockResolvedValue(undefined);
    await expect(open("teams")).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
