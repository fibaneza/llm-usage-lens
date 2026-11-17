import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  resetManageAccess,
  setManageAccess,
} from "@/test/fakes/manage-access-fake";

// Source: Design System - Management pages, Audit ("a source the caller may
// not read is not offered"; default source App when readable, else Gateway;
// App = the dashboard audit log + Access review, Gateway = LiteLLM's audit);
// slice B2 brief B2-1 (audit.app / audit.gateway flags), B2-8; Access Control
// - Audit for org admin (no readable source -> the Audit item is absent and the
// route is the same 404); Rule 10.3. The per-caller flags are asserted in
// lib/manage-access.integration.test.ts; here the manage-access fake sets them.
//
// Contract for the developer (app/dashboard/manage/audit/page.tsx):
//   default async Server Component, no props. managementAccessFor(session):
//   neither audit.app nor audit.gateway -> notFound(). Otherwise renders
//   <AuditPageContent sources={("app"|"gateway")[]} app={ReactNode|undefined} />
//   from "@/components/manage/AuditPageContent" with `sources` in the order
//   ["app", "gateway"] filtered to the readable ones; `app` is
//   <AccessSections viewer stepUp sections={["audit-log","access-review"]} />
//   only when the app source is readable.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/manage-access", async () => {
  const mod = await import("@/test/fakes/manage-access-fake");
  return mod.fakeManageAccess;
});
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/app/dashboard/settings/step-up-actions", () => ({
  stepUpWithEntra: vi.fn(),
  stepUpWithCredentials: vi.fn(),
  stepUpWithDevLogin: vi.fn(),
}));
vi.mock("@/lib/auth/settings-access", () => ({
  loadSettingsAccessViewer: async () => ({
    roles: ["internal-auditor"],
    authMethod: "entra",
    adminScopes: [],
  }),
}));
vi.mock("@/components/settings/access/AccessSections", () => ({
  AccessSections: (props: { sections: string[] }) => (
    <div data-testid="app-sections">{props.sections.join(",")}</div>
  ),
}));
vi.mock("@/components/manage/AuditPageContent", () => ({
  AuditPageContent: (props: { sources: string[]; app?: React.ReactNode }) => (
    <div data-testid="audit" data-sources={props.sources.join(",")}>
      {props.app}
    </div>
  ),
}));

import AuditPage from "./page";

afterEach(() => {
  resetManageAccess();
});

describe("AuditPage (/dashboard/manage/audit)", () => {
  it.each([
    ["both sources (admin, auditor)", true, true, "app,gateway", true],
    ["the app source only", true, false, "app", true],
    ["the gateway source only", false, true, "gateway", false],
  ])("offers %s", async (_n, app, gateway, sources, hasAppSections) => {
    setManageAccess({ audit: { app, gateway } });
    render(await AuditPage());
    expect(screen.getByTestId("audit")).toHaveAttribute(
      "data-sources",
      sources,
    );
    if (hasAppSections) {
      expect(screen.getByTestId("app-sections")).toHaveTextContent(
        "audit-log,access-review",
      );
    } else {
      expect(screen.queryByTestId("app-sections")).not.toBeInTheDocument();
    }
  });

  it("gets the 404 when neither source is readable (org admin, lead, user)", async () => {
    setManageAccess({ audit: { app: false, gateway: false } });
    await expect(AuditPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
