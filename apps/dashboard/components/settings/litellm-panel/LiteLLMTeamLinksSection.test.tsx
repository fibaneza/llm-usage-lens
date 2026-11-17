import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
// L4b - docs/specs/2026-11-17-app-teams.md, UI: "Settings -> LiteLLM -> Team
// links: a 'Spend source' column for every app team". Assumed (the spec names
// no data source): GET /api/litellm/team-links answers
// { items, appTeams: [{ teamId, teamName, spendSource }] }. The section
// renders a table named "Spend source by app team" (columns App team, Spend
// source) with one row per app team: "LiteLLM team" when linked, "Sum of
// members" when not. `appTeams` is optional: an answer without it renders the
// link list as before and no such table.
describe("LiteLLMTeamLinksSection - spend source column (App Teams: UI)", () => {
  const body = {
    items: [LINK],
    appTeams: [
      { teamId: "growth", teamName: "Growth", spendSource: "member-sum" },
      {
        teamId: "payments",
        teamName: "Payments",
        spendSource: "litellm-team",
      },
    ],
  };

  function stubBody(data: unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(apiResponse({ data }))),
    );
  }

  it("shows a 'Spend source' column with one row for every app team, linked or not", async () => {
    stubBody(body);
    renderWithProviders(<LiteLLMTeamLinksSection canEdit />);
    const table = await screen.findByRole("table", {
      name: "Spend source by app team",
    });
    expect(
      within(table).getByRole("columnheader", { name: "Spend source" }),
    ).toBeInTheDocument();
    const payments = within(table).getByRole("row", { name: /Payments/ });
    expect(within(payments).getByText("LiteLLM team")).toBeInTheDocument();
    const growth = within(table).getByRole("row", { name: /Growth/ });
    expect(within(growth).getByText("Sum of members")).toBeInTheDocument();
  });

  it("the link list and its Unlink control are unchanged beside it", async () => {
    stubBody(body);
    renderWithProviders(<LiteLLMTeamLinksSection canEdit />);
    expect(await screen.findByText("ll-111")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Unlink payments" }),
    ).toBeInTheDocument();
  });

  it("without appTeams in the answer the section renders as before and shows no spend-source table", async () => {
    stubBody({ items: body.items });
    renderWithProviders(<LiteLLMTeamLinksSection canEdit />);
    expect(await screen.findByText("ll-111")).toBeInTheDocument();
    expect(
      screen.queryByRole("table", { name: "Spend source by app team" }),
    ).toBeNull();
  });
});

// Moved from the deleted LiteLLMPanel.test.tsx (team search) and
// LiteLLMPanel.roles.test.tsx (team-link writes, editTeamLinks) - unit A2
// part 2. LD24 (Admin + org-admin link teams; Auditor read-only); L3d2: the
// DELETE route reads no body, PUT takes { litellmTeamId, version } with
// version null to create (PutBodySchema).
describe("LiteLLMTeamLinksSection list, search and writes", () => {
  const link = (teamId: string, litellmTeamId: string, version = 1) => ({
    teamId,
    litellmTeamId,
    version,
    updatedAt: "2026-11-01T00:00:00Z",
  });

  type Call = { path: string; method: string; body: unknown };

  // Stateful stub: GET /team-links reflects earlier writes.
  function stub(opts: { put?: Response; del?: Response } = {}) {
    let links = [link("payments", "ll-111"), link("search", "ll-222", 2)];
    const calls: Call[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), "http://localhost").pathname;
        const method = (init?.method ?? "GET").toUpperCase();
        calls.push({
          path,
          method,
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        if (path.startsWith("/api/litellm/team-links/")) {
          const teamId = decodeURIComponent(path.split("/").pop() ?? "");
          if (method === "DELETE") {
            if (opts.del) return Promise.resolve(opts.del);
            links = links.filter((l) => l.teamId !== teamId);
            return Promise.resolve(apiResponse({ data: { teamId } }));
          }
          if (method === "PUT") {
            if (opts.put) return Promise.resolve(opts.put);
            const body = JSON.parse(String(init?.body)) as {
              litellmTeamId: string;
              version: number | null;
            };
            const saved = link(
              teamId,
              body.litellmTeamId,
              (body.version ?? 0) + 1,
            );
            links = [...links.filter((l) => l.teamId !== teamId), saved];
            return Promise.resolve(apiResponse({ data: saved }));
          }
        }
        return Promise.resolve(apiResponse({ data: { items: links } }));
      }),
    );
    return calls;
  }

  const writesOf = (calls: Call[]) => calls.filter((c) => c.method !== "GET");

  async function open(canEdit = true) {
    renderWithProviders(<LiteLLMTeamLinksSection canEdit={canEdit} />);
    await screen.findByText("ll-111");
  }

  it("the team search box filters the link list and shows an empty state (L3b)", async () => {
    stub();
    await open();
    const box = screen.getByRole("searchbox", { name: /search teams/i });
    await userEvent.type(box, "SEAR");
    expect(screen.queryByText("ll-111")).toBeNull();
    expect(screen.getByText("ll-222")).toBeInTheDocument();
    await userEvent.clear(box);
    await userEvent.type(box, "nomatch");
    expect(screen.getByText(/no matching teams/i)).toBeInTheDocument();
  });

  it("an editor sees Unlink per link and the Link form (LD24)", async () => {
    stub();
    await open();
    expect(
      screen
        .getAllByRole("button", { name: /^unlink /i })
        .map((b) => b.getAttribute("aria-label") ?? b.textContent),
    ).toEqual(["Unlink payments", "Unlink search"]);
    expect(screen.getByLabelText("Dashboard team ID")).toBeInTheDocument();
    expect(screen.getByLabelText("LiteLLM team ID")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^link$/i })).toBeInTheDocument();
  });

  it("a read-only caller sees the list and search, no Unlink or form, and sends only GET (LD24)", async () => {
    const calls = stub();
    await open(false);
    expect(
      screen.getByRole("searchbox", { name: /search teams/i }),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: /^unlink /i })).toHaveLength(
      0,
    );
    expect(screen.queryByLabelText("Dashboard team ID")).toBeNull();
    expect(screen.queryByLabelText("LiteLLM team ID")).toBeNull();
    expect(screen.queryByRole("button", { name: /^link$/i })).toBeNull();
    expect(writesOf(calls)).toEqual([]);
  });

  it("Unlink asks for inline confirmation (no browser dialog) and Cancel sends nothing", async () => {
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmSpy);
    const calls = stub();
    await open();
    await userEvent.click(
      screen.getByRole("button", { name: "Unlink payments" }),
    );
    expect(
      screen.getByRole("button", { name: /^confirm unlink$/i }),
    ).toBeInTheDocument();
    expect(writesOf(calls)).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(
      screen.queryByRole("button", { name: /^confirm unlink$/i }),
    ).toBeNull();
    expect(writesOf(calls)).toEqual([]);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("confirming sends DELETE /api/litellm/team-links/<teamId> with no body and the row disappears", async () => {
    const calls = stub();
    await open();
    await userEvent.click(
      screen.getByRole("button", { name: "Unlink payments" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /^confirm unlink$/i }),
    );
    await waitFor(() => expect(screen.queryByText("ll-111")).toBeNull());
    expect(writesOf(calls)).toEqual([
      {
        path: "/api/litellm/team-links/payments",
        method: "DELETE",
        body: undefined,
      },
    ]);
    expect(screen.getByText("ll-222")).toBeInTheDocument();
  });

  it("an unlink failure shows inline and keeps the row", async () => {
    stub({
      del: apiResponse(
        {
          error: { code: "CONFLICT", message: "The link was changed; reload" },
        },
        409,
      ),
    });
    await open();
    await userEvent.click(
      screen.getByRole("button", { name: "Unlink payments" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /^confirm unlink$/i }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The link was changed; reload",
    );
    expect(screen.getByText("ll-111")).toBeInTheDocument();
  });

  async function fillLink(team: string, llm: string) {
    if (team) {
      await userEvent.type(screen.getByLabelText("Dashboard team ID"), team);
    }
    if (llm) {
      await userEvent.type(screen.getByLabelText("LiteLLM team ID"), llm);
    }
  }

  it("the Link form sends PUT /api/litellm/team-links/<teamId> with version null and the list shows the new link", async () => {
    const calls = stub();
    await open();
    await fillLink("growth", "ll-333");
    await userEvent.click(screen.getByRole("button", { name: /^link$/i }));
    expect(await screen.findByText("ll-333")).toBeInTheDocument();
    expect(writesOf(calls)).toEqual([
      {
        path: "/api/litellm/team-links/growth",
        method: "PUT",
        body: { litellmTeamId: "ll-333", version: null },
      },
    ]);
  });

  it("re-linking an already linked team sends that link's current version", async () => {
    const calls = stub();
    await open();
    await fillLink("search", "ll-999");
    await userEvent.click(screen.getByRole("button", { name: /^link$/i }));
    expect(await screen.findByText("ll-999")).toBeInTheDocument();
    expect(writesOf(calls).map((c) => c.body)).toEqual([
      { litellmTeamId: "ll-999", version: 2 },
    ]);
  });

  it.each([
    [404, "NOT_FOUND", "Not found"],
    [409, "CONFLICT", "The link was changed or is in use"],
  ])(
    "a %i from the server shows inline (role=alert)",
    async (status, code, message) => {
      stub({ put: apiResponse({ error: { code, message } }, status) });
      await open();
      await fillLink("growth", "ll-333");
      await userEvent.click(screen.getByRole("button", { name: /^link$/i }));
      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(screen.queryByText("ll-333")).toBeNull();
    },
  );

  // PUT body schema (app/api/litellm/team-links/[teamId]/route.ts) requires both fields.
  it.each([
    ["both empty", "", ""],
    ["only the dashboard team ID", "growth", ""],
    ["only the LiteLLM team ID", "", "ll-333"],
    ["whitespace-only dashboard team ID", "   ", "ll-333"],
    ["whitespace-only LiteLLM team ID", "growth", "   "],
  ])("Link is disabled with %s", async (_n, team, llm) => {
    stub();
    await open();
    await fillLink(team, llm);
    expect(screen.getByRole("button", { name: /^link$/i })).toBeDisabled();
  });

  it("Link is enabled once both fields are filled; Enter with a field empty sends no PUT", async () => {
    const calls = stub();
    await open();
    await userEvent.type(
      screen.getByLabelText("Dashboard team ID"),
      "growth{Enter}",
    );
    expect(writesOf(calls)).toEqual([]);
    await userEvent.type(screen.getByLabelText("LiteLLM team ID"), "ll-333");
    expect(screen.getByRole("button", { name: /^link$/i })).toBeEnabled();
  });
});
