import { describe, expect, it, vi } from "vitest";

// Source: Design System - Navigation (Sidebar), *Routes and redirects* ("the
// Settings audit entry (`/dashboard/settings?section=audit` and
// `/dashboard/settings/audit`) -> `/dashboard/manage/audit`") and Settings Page
// (the tab row has no Audit tab; Audit leaves Settings); slice B2 brief B2-3.
// The audit sections and their per-role 404 moved to the Audit page
// (app/dashboard/manage/audit/page.test.tsx). A redirect target the caller may
// not see returns that page's 404 (Access Control - Hidden means absent).
//
// Contract (app/dashboard/settings/audit/page.tsx): default Server Component
// (async allowed) that calls redirect("/dashboard/manage/audit") and reads no
// data.
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
  permanentRedirect: () => {
    throw new Error("permanentRedirect must not be used");
  },
}));

import AuditPage from "./page";

describe("settings AuditPage redirect (B2-3)", () => {
  it("redirects to Management -> Audit", async () => {
    await expect(Promise.resolve().then(() => AuditPage())).rejects.toThrow(
      "NEXT_REDIRECT:/dashboard/manage/audit",
    );
  });
});
