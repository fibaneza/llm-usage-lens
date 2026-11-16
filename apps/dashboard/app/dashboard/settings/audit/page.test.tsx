import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Source: Design System "Settings Page" (unit D, 2026-11-16: the Audit tab,
// Audit log and Access review, is visible to internal-admin and
// internal-auditor; anyone else gets the same 404 as a missing page); Access
// Control "Permission matrix" (auditLog / accessReview). Module under test:
// `app/dashboard/settings/audit/page.tsx`, rendering
// `<AccessSections viewer stepUp sections={["audit-log","access-review"]} />`.
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
vi.mock("../step-up-actions", () => ({
  stepUpWithEntra: vi.fn(),
  stepUpWithCredentials: vi.fn(),
  stepUpWithDevLogin: vi.fn(),
}));
vi.mock("@/components/settings/access/AccessSections", () => ({
  AccessSections: (props: { sections: string[] }) => (
    <div data-testid="sections">{props.sections.join(",")}</div>
  ),
}));

import AuditPage from "./page";

afterEach(() => {
  vi.clearAllMocks();
});

function as(roles: string[], scoped = false) {
  auth.mockResolvedValue({ user: { oid: "oid-1", roles } });
  loadViewer.mockResolvedValue({
    roles,
    authMethod: "entra",
    adminScopes: scoped ? [{ scopeType: "team", scopeId: "team-pay" }] : [],
  });
}

describe("AuditPage", () => {
  it.each([
    ["internal-admin", ["internal-admin"]],
    ["internal-auditor", ["internal-auditor"]],
  ])("%s sees Audit log and Access review", async (_n, roles) => {
    as(roles);
    render(await AuditPage());
    expect(screen.getByTestId("sections")).toHaveTextContent(
      "audit-log,access-review",
    );
  });

  it.each([
    ["internal-org-admin", ["internal-org-admin"], false],
    ["a team-scope admin", ["internal-viewer"], true],
    ["a viewer without a scope", ["internal-viewer"], false],
  ])("%s gets the not-found page", async (_n, roles, scoped) => {
    as(roles, scoped);
    await expect(AuditPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("a session that builds no viewer gets the not-found page", async () => {
    auth.mockResolvedValue(null);
    loadViewer.mockResolvedValue(undefined);
    await expect(AuditPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
