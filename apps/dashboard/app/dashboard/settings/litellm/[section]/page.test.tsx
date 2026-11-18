import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Source: Design System "Settings Page" - LiteLLM sub-tabs (unit A2,
// 2026-11-17, D-A2-1 / D-A2-2): the sub-tab is the route segment
// (connection | guardrails | gateway after M1 D3); visibility follows
// litellmPanelCapabilities(viewer.roles); an unknown segment or a caller
// without the tab is the same 404. Read-only flags per LD24: Connection edit
// Admin only; Guardrails and Team links Admin + org-admin; Auditor read-only.
// Rule 10.3 / 60.10 (authorized per request; viewer resolved on the server).
// Module under test: `app/dashboard/settings/litellm/[section]/page.tsx`,
// `LiteLLMSectionPage({ params: Promise<{ section: string }> })` rendering,
// under an h2 "LiteLLM" (SettingsSection), exactly one of:
//   LiteLLMConnectionSection ({canEdit}), LiteLLMGuardrailsSection ({canEdit}),
//   LiteLLMGatewaySection ({canEdit}) (M1, D3: Team links and Users moved to
//   Management -> LiteLLM and are no longer sections here), from
//   `@/components/settings/litellm-panel/<ExportName>`.
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
vi.mock("@/lib/manage-access", async () => {
  const mod = await import("@/test/fakes/manage-access-fake");
  return mod.fakeManageAccess;
});
const { flagged } = vi.hoisted(() => ({
  flagged: (id: string) => {
    function Flagged(props: { canEdit?: boolean }) {
      return <div data-testid={id}>{String(props.canEdit)}</div>;
    }
    return Flagged;
  },
}));
vi.mock("@/components/settings/litellm-panel/LiteLLMConnectionSection", () => ({
  LiteLLMConnectionSection: flagged("connection"),
}));
vi.mock("@/components/settings/litellm-panel/LiteLLMGuardrailsSection", () => ({
  LiteLLMGuardrailsSection: flagged("guardrails"),
}));
vi.mock("@/components/settings/litellm-panel/LiteLLMGatewaySection", () => ({
  LiteLLMGatewaySection: flagged("gateway"),
}));

import {
  resetManageAccess,
  setManageAccess,
} from "@/test/fakes/manage-access-fake";

import LiteLLMSectionPage from "./page";

afterEach(() => {
  vi.clearAllMocks();
  resetManageAccess();
});

function as(roles: string[], scoped = false) {
  auth.mockResolvedValue({ user: { oid: "oid-1", roles } });
  loadViewer.mockResolvedValue({
    roles,
    authMethod: "entra",
    adminScopes: scoped ? [{ scopeType: "team", scopeId: "team-pay" }] : [],
  });
}
const open = (section: string) =>
  LiteLLMSectionPage({ params: Promise.resolve({ section }) });

// L6 adds "gateway" (LiteLLM spec - Combined usage and My usage (L6): "Admin
// edits ...; Auditor and org-admin read only (configuration writes are
// Admin-only, LD24); Lead and user 404"): <LiteLLMGatewaySection canEdit />
// from `@/components/settings/litellm-panel/LiteLLMGatewaySection`.
const SECTIONS = ["connection", "guardrails", "gateway"] as const;

describe("LiteLLM settings section page", () => {
  it.each(SECTIONS)(
    "renders only the %s section, under the LiteLLM h2",
    async (section) => {
      as(["internal-admin"]);
      render(await open(section));
      expect(
        screen.getByRole("heading", { level: 2, name: "LiteLLM" }),
      ).toBeInTheDocument();
      for (const other of SECTIONS) {
        expect(screen.queryByTestId(other) !== null).toBe(other === section);
      }
    },
  );

  // LD24 role x section edit flags: the complete matrix (security).
  it.each([
    ["internal-admin", "connection", "true"],
    ["internal-admin", "guardrails", "true"],
    ["internal-org-admin", "connection", "false"],
    ["internal-org-admin", "guardrails", "true"],
    ["internal-auditor", "connection", "false"],
    ["internal-auditor", "guardrails", "false"],
    ["internal-admin", "gateway", "true"],
    ["internal-org-admin", "gateway", "false"],
    ["internal-auditor", "gateway", "false"],
  ])("%s on %s passes canEdit=%s", async (role, section, flag) => {
    as([role]);
    render(await open(section));
    expect(screen.getByTestId(section)).toHaveTextContent(flag);
  });

  it.each([["internal-admin"], ["internal-org-admin"], ["internal-auditor"]])(
    "%s may open Gateway (read-only below Admin)",
    async (role) => {
      as([role]);
      render(await open("gateway"));
      expect(screen.getByTestId("gateway")).toBeInTheDocument();
    },
  );

  it.each([
    ["internal-viewer", false],
    ["internal-viewer", true],
    ["Admin", false],
  ])(
    "a caller with roles [%s] (scoped %s) gets the not-found page for every section",
    async (role, scoped) => {
      as([role], scoped);
      for (const section of SECTIONS) {
        await expect(open(section)).rejects.toThrow("NEXT_NOT_FOUND");
      }
      expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    },
  );

  it.each([
    "nope",
    "constructor",
    "audit",
    "Connection",
    "connection/x",
    "",
    "team-links",
    "users",
  ])(
    "an unknown section %j is the not-found page, even for an admin",
    async (section) => {
      as(["internal-admin"]);
      await expect(open(section)).rejects.toThrow("NEXT_NOT_FOUND");
    },
  );

  it("a session that builds no viewer gets the not-found page", async () => {
    auth.mockResolvedValue(null);
    loadViewer.mockResolvedValue(undefined);
    await expect(open("connection")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("a closed Settings (management gate) wins over the role", async () => {
    setManageAccess({ settings: false });
    as(["internal-admin"]);
    await expect(open("connection")).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
