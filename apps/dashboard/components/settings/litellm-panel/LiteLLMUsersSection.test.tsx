import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiError, apiResponse } from "@/test/fakes/api-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { LiteLLMUsersSection } from "./LiteLLMUsersSection";

// Source: Design System "Settings Page" - LiteLLM sub-tabs, agent decision (3)
// (unit A2, 2026-11-17; gap G7) and Management improvements, LiteLLM users tab
// (D16a, unit M3): the tab opens on the users list (page 1, 25 a page, no
// search text) with the search box narrowing it, so users ARE requested on
// open. Module under test:
// `components/settings/litellm-panel/LiteLLMUsersSection.tsx`
//   <LiteLLMUsersSection />   (no props)
// = the list plus, when GET /api/litellm/team-links returns no item, a
// role="status" note. Copy fixed here (the developer matches it):
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
      const url = new URL(String(input), "http://localhost");
      calls.push(url.pathname + url.search);
      if (url.pathname === "/api/litellm/users") {
        return Promise.resolve(
          apiResponse({
            data: {
              users: [],
              page: 1,
              pageSize: 25,
              hasMore: false,
              enabledOperations: [],
            },
          }),
        );
      }
      if (url.pathname === "/api/litellm/team-links") {
        return Promise.resolve(apiResponse({ data: { items } }));
      }
      return Promise.resolve(apiError(404, "NOT_FOUND"));
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

  it("with a team linked, shows the search and no explanation; lists users page 1 on open (D16a)", async () => {
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
    await vi.waitFor(() =>
      expect(calls).toContain("/api/litellm/users?page=1&pageSize=25"),
    );
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
