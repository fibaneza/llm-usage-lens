import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiResponse } from "@/test/fakes/api-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { LiteLLMUsersSection } from "./LiteLLMUsersSection";

// Source: Design System "Settings Page" - LiteLLM sub-tabs, agent decision (3)
// (unit A2, 2026-11-17; gap G7); Design System "LiteLLM Page" (the shared
// UserSearch, no request until a term is typed). Module under test:
// `components/settings/litellm-panel/LiteLLMUsersSection.tsx`
//   <LiteLLMUsersSection />   (no props)
// = the shared `UserSearch` plus, when GET /api/litellm/team-links returns no
// item, a role="status" note. Copy fixed here (the developer matches it):
//   "No LiteLLM team is linked yet. User search lists LiteLLM users; a user's
//    spend appears per team once a team is linked under Team links."
afterEach(() => {
  vi.unstubAllGlobals();
});

function stub(items: unknown[]) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname;
      calls.push(path);
      return Promise.resolve(apiResponse({ data: { items } }));
    }),
  );
  return calls;
}

describe("LiteLLMUsersSection", () => {
  it("with no team linked, explains what the search lists and when spend appears (G7)", async () => {
    stub([]);
    renderWithProviders(<LiteLLMUsersSection />);
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("No LiteLLM team is linked yet.");
    expect(status).toHaveTextContent(/user search lists litellm users/i);
    expect(status).toHaveTextContent(
      /spend appears per team once a team is linked/i,
    );
    expect(
      screen.getByRole("searchbox", { name: /search users/i }),
    ).toBeInTheDocument();
  });

  it("with a team linked, shows the search and no explanation; requests no users until a term is typed", async () => {
    const calls = stub([
      {
        teamId: "payments",
        litellmTeamId: "ll-111",
        version: 1,
        updatedAt: "2026-11-01T00:00:00Z",
      },
    ]);
    renderWithProviders(<LiteLLMUsersSection />);
    expect(
      await screen.findByRole("searchbox", { name: /search users/i }),
    ).toBeInTheDocument();
    await vi.waitFor(() => expect(calls).toContain("/api/litellm/team-links"));
    expect(screen.queryByRole("status")).toBeNull();
    expect(calls).not.toContain("/api/litellm/users");
  });

  it("shows no explanation while the team links are loading", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    renderWithProviders(<LiteLLMUsersSection />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
