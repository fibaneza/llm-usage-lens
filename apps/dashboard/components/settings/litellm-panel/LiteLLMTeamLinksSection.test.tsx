import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiResponse } from "@/test/fakes/api-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { LiteLLMTeamLinksSection } from "./LiteLLMTeamLinksSection";

// Source: Design System "Settings Page" - LiteLLM sub-tabs, agent decision (3)
// (unit A2, 2026-11-17; gap G7 of the L3b acceptance review: an unexplained
// empty state when no team is linked); LiteLLM spec LD24 (Admin and org-admin
// link teams; Auditor read-only). Module under test:
// `components/settings/litellm-panel/LiteLLMTeamLinksSection.tsx`
//   <LiteLLMTeamLinksSection canEdit={boolean} />
// (the Team links body of the former LiteLLMPanel tab, behaviour unchanged).
// Copy fixed here (the developer matches it):
//   no links, all roles:  role="status" containing "No LiteLLM team is linked yet."
//   no links, canEdit:    + "Linking a dashboard team to a LiteLLM team shows
//                          that team's LiteLLM spend, budget and members in the
//                          dashboard. The form below links one."
//   no links, read-only:  + "An Admin or org-admin links teams."
afterEach(() => {
  vi.unstubAllGlobals();
});

const LINK = {
  teamId: "payments",
  litellmTeamId: "ll-111",
  version: 1,
  updatedAt: "2026-11-01T00:00:00Z",
};

function stubLinks(items: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(apiResponse({ data: { items } }))),
  );
}

describe("LiteLLMTeamLinksSection - empty state when no team is linked (G7)", () => {
  it("an editor is told what linking does and where to link", async () => {
    stubLinks([]);
    renderWithProviders(<LiteLLMTeamLinksSection canEdit />);
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("No LiteLLM team is linked yet.");
    expect(status).toHaveTextContent(/spend, budget and members/i);
    expect(status).toHaveTextContent(/the form below links one/i);
    expect(status).not.toHaveTextContent(/admin or org-admin links teams/i);
    expect(screen.getByLabelText("Dashboard team ID")).toBeInTheDocument();
  });

  it("a read-only caller is told who links teams, and has no form", async () => {
    stubLinks([]);
    renderWithProviders(<LiteLLMTeamLinksSection canEdit={false} />);
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("No LiteLLM team is linked yet.");
    expect(status).toHaveTextContent(/an admin or org-admin links teams/i);
    expect(status).not.toHaveTextContent(/form below/i);
    expect(screen.queryByLabelText("Dashboard team ID")).toBeNull();
  });

  it("shows the explanation only when no team is linked: not with links, not while loading", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    const pending = renderWithProviders(<LiteLLMTeamLinksSection canEdit />);
    expect(screen.queryByRole("status")).toBeNull();
    pending.unmount();
    vi.unstubAllGlobals();

    stubLinks([LINK]);
    renderWithProviders(<LiteLLMTeamLinksSection canEdit />);
    expect(await screen.findByText("ll-111")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
