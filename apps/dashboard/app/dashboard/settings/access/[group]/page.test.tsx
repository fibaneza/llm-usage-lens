import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Source: Design System "Settings Page" - Access sub-tabs (unit D, 2026-11-16:
// the sub-tab is the route segment; an unknown or unusable segment is the same
// 404); Rule 10.3 / 50.3 (viewer resolved on the server and passed down),
// Access Control "Recent authentication" (the page hands the Server Actions to
// the client as props). Module under test:
// `app/dashboard/settings/access/[group]/page.tsx`, an async Server Component
// `AccessGroupPage({ params: Promise<{ group: string }> })` rendering
//   <AccessSections viewer stepUp={{entra, credentials, devLogin}} sections />
// with `sections` taken from `settingsTabsFor(viewer)`'s sub-tab. Moved from the
// old page.access.test.tsx: viewer + the three step-up actions passed down; no
// viewer reaches no data (there: "passes no access prop").
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
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));
const stepUpWithEntra = vi.fn();
const stepUpWithCredentials = vi.fn();
const stepUpWithDevLogin = vi.fn();
vi.mock("../../step-up-actions", () => ({
  stepUpWithEntra: (...args: unknown[]) => stepUpWithEntra(...args),
  stepUpWithCredentials: (...args: unknown[]) => stepUpWithCredentials(...args),
  stepUpWithDevLogin: (...args: unknown[]) => stepUpWithDevLogin(...args),
}));
type Props = {
  viewer: unknown;
  stepUp: { entra: unknown; credentials: unknown; devLogin: unknown };
  sections: string[];
};
const sections = vi.fn((props: Props) => (
  <div data-testid="sections">{props.sections.join(",")}</div>
));
vi.mock("@/components/settings/access/AccessSections", () => ({
  AccessSections: (props: Props) => sections(props),
}));

// Slice B2 B2-10: the gate matrix lives in the manage-routes integration test.
vi.mock("@/lib/manage-access", async () => {
  const mod = await import("@/test/fakes/manage-access-fake");
  return mod.fakeManageAccess;
});

import AccessGroupPage from "./page";

afterEach(() => {
  vi.clearAllMocks();
});

function as(roles: string[], scoped = false) {
  const viewer = {
    roles,
    authMethod: "entra",
    adminScopes: scoped ? [{ scopeType: "team", scopeId: "team-pay" }] : [],
  };
  auth.mockResolvedValue({ user: { oid: "oid-1", roles } });
  loadViewer.mockResolvedValue(viewer);
  return viewer;
}
const open = (group: string) =>
  AccessGroupPage({ params: Promise.resolve({ group }) });

describe("AccessGroupPage", () => {
  it("passes the resolved viewer, the three step-up actions and the sub-tab's sections", async () => {
    const viewer = as(["internal-auditor"]);
    render(await open("roles"));
    const props = sections.mock.calls[0]?.[0];
    expect(props?.viewer).toEqual(viewer);
    expect(props?.sections).toEqual(["group-mappings", "role-grants"]);
    const stepUp = props?.stepUp as {
      entra: () => Promise<void>;
      credentials: (fd: FormData) => unknown;
      devLogin: () => Promise<void>;
    };
    expect(typeof stepUp.devLogin).toBe("function");
    expect(stepUpWithEntra).not.toHaveBeenCalled();
    await stepUp.entra();
    expect(stepUpWithEntra).toHaveBeenCalledTimes(1);
    const form = new FormData();
    await stepUp.credentials(form);
    expect(stepUpWithCredentials.mock.calls[0]?.[0]).toBe(form);
  });

  it("an admin's Sign-in sub-tab renders Password users and Per-user approval", async () => {
    as(["internal-admin"]);
    render(await open("sign-in"));
    expect(screen.getByTestId("sections")).toHaveTextContent(
      "password-users,per-user-approval",
    );
  });

  it.each([
    ["internal-org-admin", ["internal-org-admin"], false, "people"],
    ["internal-org-admin", ["internal-org-admin"], false, "visibility"],
    ["a team-scope admin", ["internal-viewer"], true, "people"],
    ["internal-auditor", ["internal-auditor"], false, "identities"],
  ])("%s may open %s", async (_n, roles, scoped, group) => {
    as(roles, scoped);
    render(await open(group));
    expect(sections).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["internal-org-admin", ["internal-org-admin"], false, "roles"],
    ["internal-org-admin", ["internal-org-admin"], false, "sign-in"],
    ["a team-scope admin", ["internal-viewer"], true, "identities"],
    ["internal-auditor", ["internal-auditor"], false, "visibility"],
    ["a viewer without a scope", ["internal-viewer"], false, "people"],
    ["internal-admin", ["internal-admin"], false, "nope"],
    ["internal-admin", ["internal-admin"], false, "constructor"],
    ["internal-admin", ["internal-admin"], false, "audit"],
  ])(
    "%s opening %s gets the not-found page",
    async (_n, roles, scoped, group) => {
      as(roles, scoped);
      await expect(open(group)).rejects.toThrow("NEXT_NOT_FOUND");
      expect(sections).not.toHaveBeenCalled();
    },
  );

  it("a session that builds no viewer gets the not-found page", async () => {
    auth.mockResolvedValue({ user: { oid: "oid-1", roles: [] } });
    loadViewer.mockResolvedValue(undefined);
    await expect(open("people")).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
