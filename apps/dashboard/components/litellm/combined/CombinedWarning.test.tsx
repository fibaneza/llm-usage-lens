import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ME_ADMIN, stubRoutes } from "@/test/fakes/combined-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { CombinedWarning } from "./CombinedWarning";

// Source: docs/specs/2026-11-10-litellm.md - "Combined usage and My usage
// (L6)" -> States: Gateway not configured, `warn`: "the text **gateway not
// configured — totals may double count** (`role="status"`; Admin also gets a
// link to the Gateway sub-tab)"; Visibility (org-admin gets the warning, not
// hiding; Auditor too); configuration writes are Admin-only (LD24); Rule 50.3
// (role names come from lib/auth/roles - the component reads GET /api/me).
// Module under test: `components/litellm/combined/CombinedWarning.tsx`
//   <CombinedWarning />   (client; no props; reads GET /api/me `roles`)
// Contract: role="status" with the exact text; a link named "Configure the
// gateway" to /dashboard/settings/litellm/gateway only for internal-admin.
afterEach(() => {
  vi.unstubAllGlobals();
});

const WARNING = "gateway not configured — totals may double count";

describe("CombinedWarning", () => {
  it("an Admin gets the text and a link to the Gateway sub-tab", async () => {
    stubRoutes({ "/api/me": ME_ADMIN });
    renderWithProviders(<CombinedWarning />);
    expect(screen.getByRole("status")).toHaveTextContent(WARNING);
    const link = await screen.findByRole("link", {
      name: "Configure the gateway",
    });
    expect(link).toHaveAttribute("href", "/dashboard/settings/litellm/gateway");
  });

  it.each([["internal-org-admin"], ["internal-auditor"]])(
    "%s gets the text and no link (read-only on the Gateway sub-tab)",
    async (role) => {
      const { urls } = stubRoutes({
        "/api/me": { ...ME_ADMIN, roles: [role] },
      });
      renderWithProviders(<CombinedWarning />);
      expect(screen.getByRole("status")).toHaveTextContent(WARNING);
      await vi.waitFor(() => expect(urls.length).toBeGreaterThan(0));
      expect(screen.queryByRole("link")).toBeNull();
    },
  );

  it("shows the text when GET /api/me fails, with no link", async () => {
    stubRoutes({}); // /api/me -> 404
    renderWithProviders(<CombinedWarning />);
    expect(screen.getByRole("status")).toHaveTextContent(WARNING);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
