import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiResponse } from "@/test/fakes/api-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { LiteLLMTeamLinksSection } from "./LiteLLMTeamLinksSection";

// Source: Design System "Management pages" - LiteLLM area, LiteLLM teams tab
// (D2/D3/D4a, 2026-11-17); LiteLLM spec LD24 (Admin and org-admin link teams;
// Auditor read-only), LD37, MI-D4a, LT-MI3; App Teams spec - UI (spend source).
// Module under test:
//   <LiteLLMTeamLinksSection canEdit canCreateTeam? />
// It reads GET /api/litellm/team-links ({ items, appTeams?, litellmTeams?,
// litellmTeamsUnavailable?, configured? }) and, for an editor or creator,
// GET /api/access/org-units (the app teams of the Team picker).
// Copy fixed by the empty-state tests (unit A2 / G7):
//   no links, all roles:  role="status" containing "No LiteLLM team is linked yet."
//   no links, canEdit:    + "... The form below links one."
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
const link = (teamId: string, litellmTeamId: string, version = 1) => ({
  teamId,
  litellmTeamId,
  version,
  updatedAt: "2026-11-01T00:00:00Z",
});
const ORG_UNITS = {
  teams: [
    { id: "growth", name: "Growth", departmentId: "eng" },
    { id: "payments", name: "Payments", departmentId: "eng" },
    { id: "search", name: "Search", departmentId: "eng" },
  ],
  departments: [{ id: "eng", name: "Engineering" }],
};
const LITELLM_TEAMS = [
  { litellmTeamId: "ll-111", alias: "Alpha" },
  { litellmTeamId: "ll-222", alias: "Beta" },
  { litellmTeamId: "ll-333", alias: "Gamma" },
];

type Call = { path: string; method: string; body: unknown };
type Body = Record<string, unknown>;

// Stateful stub: GET /team-links reflects earlier writes; /api/access/org-units
// answers the app teams. `extra` is merged into the team-links answer.
function stub(
  opts: {
    links?: ReturnType<typeof link>[];
    extra?: Body;
    put?: Response;
    del?: Response;
    post?: Response;
  } = {},
) {
  let links = opts.links ?? [
    link("payments", "ll-111"),
    link("search", "ll-222", 2),
  ];
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
      if (path === "/api/access/org-units") {
        return Promise.resolve(apiResponse({ data: ORG_UNITS }));
      }
      if (path === "/api/litellm/teams" && method === "POST") {
        return Promise.resolve(
          opts.post ??
            apiResponse({
              data: { teamId: "growth", litellmTeamId: "ll-444" },
            }),
        );
      }
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
      return Promise.resolve(
        apiResponse({
          data: {
            items: links,
            configured: true,
            litellmTeams: LITELLM_TEAMS,
            ...opts.extra,
          },
        }),
      );
    }),
  );
  return calls;
}

const writesOf = (calls: Call[]) => calls.filter((c) => c.method !== "GET");

describe("LiteLLMTeamLinksSection - empty state when no team is linked (G7)", () => {
  it("an editor is told what linking does and where to link", async () => {
    stub({ links: [] });
    renderWithProviders(<LiteLLMTeamLinksSection canEdit />);
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("No LiteLLM team is linked yet.");
    expect(status).toHaveTextContent(/spend, budget and members/i);
    expect(status).toHaveTextContent(/the form below links one/i);
    expect(status).not.toHaveTextContent(/admin or org-admin links teams/i);
    expect(
      await screen.findByRole("combobox", { name: "Team" }),
    ).toBeInTheDocument();
  });

  it("a read-only caller is told who links teams, and has no form", async () => {
    stub({ links: [] });
    renderWithProviders(<LiteLLMTeamLinksSection canEdit={false} />);
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("No LiteLLM team is linked yet.");
    expect(status).toHaveTextContent(/an admin or org-admin links teams/i);
    expect(status).not.toHaveTextContent(/form below/i);
    expect(screen.queryByRole("combobox", { name: "Team" })).toBeNull();
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

    stub({ links: [LINK] });
    renderWithProviders(<LiteLLMTeamLinksSection canEdit />);
    expect(await screen.findByText("ll-111")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });
});

// L4b - docs/specs/2026-11-17-app-teams.md, UI: a 'Spend source' column for
// every app team. The section renders a table named "Spend source by app team"
// (columns App team, Spend source), "LiteLLM team" when linked, "Sum of
// members" when not. `appTeams` is optional: an answer without it renders the
// link list as before and no such table.
describe("LiteLLMTeamLinksSection - spend source column (App Teams: UI)", () => {
  const appTeams = [
    { teamId: "growth", teamName: "Growth", spendSource: "member-sum" },
    { teamId: "payments", teamName: "Payments", spendSource: "litellm-team" },
  ];

  it("the Spend source column has a row for each linked app team only; an app team with no LiteLLM team is absent (Design System - Management pages, D-LF3 / T-LF4)", async () => {
    stub({ links: [LINK], extra: { appTeams } });
    renderWithProviders(<LiteLLMTeamLinksSection canEdit />);
    const table = await screen.findByRole("table", {
      name: "Spend source by app team",
    });
    expect(
      within(table).getByRole("columnheader", { name: "Spend source" }),
    ).toBeInTheDocument();
    const payments = within(table).getByRole("row", { name: /Payments/ });
    expect(within(payments).getByText("LiteLLM team")).toBeInTheDocument();
    expect(within(table).queryByRole("row", { name: /Growth/ })).toBeNull();
    expect(within(table).queryByText("Sum of members")).toBeNull();
  });

  it("when no app team is linked to a LiteLLM team the spend-source table is absent (D-LF3 / T-LF4)", async () => {
    stub({
      links: [],
      extra: {
        appTeams: [
          { teamId: "growth", teamName: "Growth", spendSource: "member-sum" },
        ],
      },
    });
    renderWithProviders(<LiteLLMTeamLinksSection canEdit />);
    await screen.findByRole("table", { name: "LiteLLM teams" });
    expect(
      screen.queryByRole("table", { name: "Spend source by app team" }),
    ).toBeNull();
  });

  it("without appTeams in the answer the section renders as before and shows no spend-source table", async () => {
    stub({ links: [LINK] });
    renderWithProviders(<LiteLLMTeamLinksSection canEdit />);
    expect(await screen.findByText("ll-111")).toBeInTheDocument();
    expect(
      screen.queryByRole("table", { name: "Spend source by app team" }),
    ).toBeNull();
  });
});

// LD24: Admin + org-admin link teams, Auditor read-only; the DELETE route reads
// no body; PUT takes { litellmTeamId, version } with version null to create.
describe("LiteLLMTeamLinksSection list, search and unlink", () => {
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

  it("an editor sees Unlink per link (LD24)", async () => {
    stub();
    await open();
    expect(
      screen
        .getAllByRole("button", { name: /^unlink /i })
        .map((b) => b.getAttribute("aria-label") ?? b.textContent),
    ).toEqual(["Unlink payments", "Unlink search"]);
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
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button", { name: /^link$/i })).toBeNull();
    expect(screen.queryByRole("form", { name: "New LiteLLM team" })).toBeNull();
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
});

// D4a / MI-D4a / LT-MI3: the link form is two searchable lists. The id of
// either team is never typed; the server still validates (400/404/409).
describe("LiteLLMTeamLinksSection link form (D4a, LT-MI3)", () => {
  async function openForm(canCreateTeam = false) {
    renderWithProviders(
      <LiteLLMTeamLinksSection canEdit canCreateTeam={canCreateTeam} />,
    );
    await screen.findByText("ll-111");
    return screen.findByRole("combobox", { name: "Team" });
  }
  async function choose(label: string, option: RegExp) {
    await userEvent.click(screen.getByRole("combobox", { name: label }));
    await userEvent.click(screen.getByRole("option", { name: option }));
  }

  it("offers every app team and every LiteLLM team, linked ones shown as linked and not selectable", async () => {
    stub();
    await userEvent.click(await openForm());
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      expect.stringContaining("Growth"),
      expect.stringContaining("Payments"),
      expect.stringContaining("Search"),
    ]);
    const linked = screen
      .getAllByRole("option")
      .filter((o) => o.getAttribute("aria-disabled") === "true")
      .map((o) => o.textContent ?? "");
    expect(linked).toHaveLength(2);
    expect(linked[0]).toContain("Payments");
    expect(linked[1]).toContain("Search");
    await userEvent.keyboard("{Escape}");

    await userEvent.click(
      screen.getByRole("combobox", { name: "LiteLLM team" }),
    );
    const llm = screen.getAllByRole("option");
    expect(llm.map((o) => o.textContent)).toEqual([
      expect.stringMatching(/Alpha.*ll-111/),
      expect.stringMatching(/Beta.*ll-222/),
      expect.stringMatching(/Gamma.*ll-333/),
    ]);
    expect(llm.map((o) => o.getAttribute("aria-disabled") === "true")).toEqual([
      true,
      true,
      false,
    ]);
  });

  it("has no text input that accepts an id anywhere in the section", async () => {
    stub();
    await openForm();
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.queryByLabelText(/team id/i)).toBeNull();
  });

  it("choosing an app team and a LiteLLM team sends PUT with version null, and the list shows the new link", async () => {
    const calls = stub();
    await openForm();
    await choose("Team", /Growth/);
    await choose("LiteLLM team", /Gamma/);
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

  it("Link is disabled until both lists have a choice, and nothing is sent", async () => {
    const calls = stub();
    await openForm();
    const button = screen.getByRole("button", { name: /^link$/i });
    expect(button).toBeDisabled();
    await choose("Team", /Growth/);
    expect(button).toBeDisabled();
    await choose("LiteLLM team", /Gamma/);
    expect(button).toBeEnabled();
    expect(writesOf(calls)).toEqual([]);
  });

  it.each([
    [404, "NOT_FOUND", "Not found"],
    [409, "CONFLICT", "The link was changed or is in use"],
  ])(
    "a %i from the server shows inline (role=alert)",
    async (status, code, message) => {
      stub({ put: apiResponse({ error: { code, message } }, status) });
      await openForm();
      await choose("Team", /Growth/);
      await choose("LiteLLM team", /Gamma/);
      await userEvent.click(screen.getByRole("button", { name: /^link$/i }));
      expect(await screen.findByRole("alert")).toHaveTextContent(message);
    },
  );

  it("LiteLLM teams unavailable (outage or toggle off): the section says so, the links still list, and there is no LiteLLM picker or typed fallback", async () => {
    stub({ extra: { litellmTeams: undefined, litellmTeamsUnavailable: true } });
    await openForm();
    expect(
      screen.getByText("LiteLLM teams could not be loaded"),
    ).toBeInTheDocument();
    expect(screen.getByText("ll-222")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "LiteLLM team" })).toBeNull();
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.getByRole("button", { name: /^link$/i })).toBeDisabled();
  });

  it("LiteLLM not configured (LD37, configured:false): the section says LiteLLM is not connected, with no LiteLLM picker or typed fallback", async () => {
    stub({
      links: [],
      extra: { configured: false, litellmTeams: undefined },
    });
    renderWithProviders(<LiteLLMTeamLinksSection canEdit />);
    expect(
      await screen.findByText(/litellm.*not (connected|configured)/i, {
        selector: "p",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "LiteLLM team" })).toBeNull();
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  });

  it("an app team list that cannot be read says so and offers no typed fallback", async () => {
    stub();
    const base = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
        String(input).includes("/api/access/org-units")
          ? Promise.resolve(
              apiResponse({ error: { code: "FORBIDDEN", message: "no" } }, 403),
            )
          : base(input, init),
      ),
    );
    renderWithProviders(<LiteLLMTeamLinksSection canEdit />);
    expect(
      await screen.findByText("Teams could not be loaded"),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  });
});

// D2 / LD24: "New LiteLLM team" is for internal-admin only (canCreateTeam); the
// route stays internal-admin only and answers 403 to anyone else (Rule 10.3).
describe("LiteLLMTeamLinksSection - New LiteLLM team (internal-admin only)", () => {
  it("is absent for an editor who may not create a team, and absent for a read-only caller", async () => {
    stub();
    const { unmount } = renderWithProviders(
      <LiteLLMTeamLinksSection canEdit />,
    );
    await screen.findByRole("combobox", { name: "Team" });
    expect(screen.queryByRole("form", { name: "New LiteLLM team" })).toBeNull();
    unmount();
    renderWithProviders(<LiteLLMTeamLinksSection canEdit={false} />);
    await screen.findByText("ll-111");
    expect(screen.queryByRole("form", { name: "New LiteLLM team" })).toBeNull();
  });

  it("renders for canCreateTeam and posts to POST /api/litellm/teams with the chosen app team and the alias", async () => {
    const calls = stub();
    renderWithProviders(<LiteLLMTeamLinksSection canEdit canCreateTeam />);
    const form = await screen.findByRole("form", { name: "New LiteLLM team" });
    await userEvent.click(
      within(form).getByRole("combobox", { name: "Team to create it for" }),
    );
    await userEvent.click(screen.getByRole("option", { name: /Growth/ }));
    await userEvent.type(
      within(form).getByLabelText("LiteLLM team alias"),
      "Growth",
    );
    await userEvent.click(
      within(form).getByRole("button", { name: "New LiteLLM team" }),
    );
    await waitFor(() => expect(writesOf(calls)).toHaveLength(1));
    expect(writesOf(calls)[0]).toEqual({
      path: "/api/litellm/teams",
      method: "POST",
      body: { teamId: "growth", teamAlias: "Growth" },
    });
  });
});

// Design System - Management pages, LiteLLM area and D-LF3 (T-LF4): the LiteLLM
// teams table has a row for a team that exists in LiteLLM (listTeams), linked or
// not; an app team with no LiteLLM team has no row, yet stays choosable in the
// link form and in New LiteLLM team (internal-admin only); RS2's members action
// stays on every remaining row.
describe("LiteLLMTeamLinksSection - LiteLLM teams are the rows (D-LF3, T-LF4)", () => {
  const appTeams = [
    { teamId: "growth", teamName: "Growth", spendSource: "member-sum" },
    { teamId: "payments", teamName: "Payments", spendSource: "litellm-team" },
    { teamId: "search", teamName: "Search", spendSource: "litellm-team" },
  ];

  it("lists the LiteLLM teams (linked or not) with a Members action on each, and no row for the unlinked app team Growth", async () => {
    stub({ extra: { appTeams } });
    renderWithProviders(<LiteLLMTeamLinksSection canEdit />);
    const table = await screen.findByRole("table", { name: "LiteLLM teams" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("Alpha"),
      expect.stringContaining("Beta"),
      expect.stringContaining("Gamma"),
    ]);
    for (const alias of ["Alpha", "Beta", "Gamma"]) {
      expect(
        within(table).getByRole("button", { name: `Members of ${alias}` }),
      ).toBeInTheDocument();
    }
    expect(screen.queryByRole("row", { name: /Growth/ })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Members of Growth/ }),
    ).toBeNull();
  });

  it("an app team with no LiteLLM team is still chosen in the link form and in New LiteLLM team (admin)", async () => {
    stub({ extra: { appTeams } });
    renderWithProviders(<LiteLLMTeamLinksSection canEdit canCreateTeam />);
    await screen.findByRole("table", { name: "LiteLLM teams" });
    await userEvent.click(
      await screen.findByRole("combobox", { name: "Team" }),
    );
    expect(screen.getByRole("option", { name: /Growth/ })).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await userEvent.keyboard("{Escape}");
    const form = screen.getByRole("form", { name: "New LiteLLM team" });
    await userEvent.click(
      within(form).getByRole("combobox", { name: "Team to create it for" }),
    );
    expect(screen.getByRole("option", { name: /Growth/ })).toBeInTheDocument();
  });

  it("an org-admin (edits, cannot create) links Growth but has no New LiteLLM team; the auditor has the table and Members, no form (LD24)", async () => {
    stub({ extra: { appTeams } });
    const { unmount } = renderWithProviders(
      <LiteLLMTeamLinksSection canEdit />,
    );
    await screen.findByRole("table", { name: "LiteLLM teams" });
    await userEvent.click(
      await screen.findByRole("combobox", { name: "Team" }),
    );
    expect(screen.getByRole("option", { name: /Growth/ })).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "New LiteLLM team" })).toBeNull();
    unmount();

    renderWithProviders(<LiteLLMTeamLinksSection canEdit={false} />);
    await screen.findByRole("table", { name: "LiteLLM teams" });
    expect(
      screen.getByRole("button", { name: "Members of Alpha" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /Growth/ })).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("form", { name: "New LiteLLM team" })).toBeNull();
  });
});

// Sources: Design System - "Sorting in the other tables (unit SRT1, 2026-11-24;
// D-SR1, D-SR2)": the LiteLLM teams table sorts in the browser with the one
// SortableHeader; the sort lives in the URL (nuqs `sort`, `dir`); it survives a
// refetch; no new read. Contract: the one sortable column is "LiteLLM team"
// (the alias), key `team`; the Members action column is not sortable; with no
// (or an unknown) URL sort the table keeps the server's order and no header is
// active. Ties are not observable here: equal aliases render identically.
const SHUFFLED = [
  { litellmTeamId: "ll-3", alias: "Gamma" },
  { litellmTeamId: "ll-1", alias: "Alpha" },
  { litellmTeamId: "ll-2", alias: "Beta" },
];

async function teamsTable() {
  return screen.findByRole("table", { name: "LiteLLM teams" });
}
const aliasOrder = (table: HTMLElement) =>
  within(table)
    .getAllByRole("row")
    .slice(1)
    .map((r) => within(r).getAllByRole("cell")[0]?.textContent);

describe("LiteLLMTeamLinksSection teams table sorting (unit SRT1; D-SR1)", () => {
  it("the LiteLLM team header is a SortableHeader button; Members is not; the server order holds by default", async () => {
    stub({ extra: { litellmTeams: SHUFFLED } });
    renderWithProviders(<LiteLLMTeamLinksSection canEdit />);
    const table = await teamsTable();
    const header = within(table).getByRole("columnheader", {
      name: "LiteLLM team",
    });
    expect(within(header).getByRole("button")).toBeInTheDocument();
    expect(header).toHaveAttribute("aria-sort", "none");
    expect(
      within(
        within(table).getByRole("columnheader", { name: "Members" }),
      ).queryByRole("button"),
    ).toBeNull();
    expect(aliasOrder(table)).toEqual(["Gamma", "Alpha", "Beta"]);
  });

  it.each([
    ["asc", "ascending", ["Alpha", "Beta", "Gamma"]],
    ["desc", "descending", ["Gamma", "Beta", "Alpha"]],
  ])(
    "the URL sort=team dir=%s sets aria-sort and orders the aliases",
    async (dir, ariaSort, expected) => {
      stub({ extra: { litellmTeams: SHUFFLED } });
      renderWithProviders(<LiteLLMTeamLinksSection canEdit />, {
        searchParams: { sort: "team", dir },
      });
      const table = await teamsTable();
      expect(
        within(table).getByRole("columnheader", { name: "LiteLLM team" }),
      ).toHaveAttribute("aria-sort", ariaSort);
      expect(aliasOrder(table)).toEqual(expected);
    },
  );

  it("an unknown URL sort falls back to the server order", async () => {
    stub({ extra: { litellmTeams: SHUFFLED } });
    renderWithProviders(<LiteLLMTeamLinksSection canEdit />, {
      searchParams: { sort: "spend", dir: "desc" },
    });
    const table = await teamsTable();
    expect(aliasOrder(table)).toEqual(["Gamma", "Alpha", "Beta"]);
    expect(
      within(table).getByRole("columnheader", { name: "LiteLLM team" }),
    ).toHaveAttribute("aria-sort", "none");
  });

  it("a header click sorts in the browser, flips on the second click and issues no new read", async () => {
    const u = userEvent.setup();
    const calls = stub({ extra: { litellmTeams: SHUFFLED } });
    renderWithProviders(<LiteLLMTeamLinksSection canEdit />);
    const table = await teamsTable();
    const reads = calls.length;
    const button = within(
      within(table).getByRole("columnheader", { name: "LiteLLM team" }),
    ).getByRole("button");
    await u.click(button);
    await waitFor(() =>
      expect(aliasOrder(table)).toEqual(["Alpha", "Beta", "Gamma"]),
    );
    await u.click(button);
    await waitFor(() =>
      expect(aliasOrder(table)).toEqual(["Gamma", "Beta", "Alpha"]),
    );
    expect(calls).toHaveLength(reads);
  });

  it("the sort survives a refetch: the new list arrives in the chosen order", async () => {
    const extra: { litellmTeams: typeof SHUFFLED } = {
      litellmTeams: SHUFFLED,
    };
    const calls = stub({ extra });
    renderWithProviders(<LiteLLMTeamLinksSection canEdit />, {
      searchParams: { sort: "team", dir: "asc" },
    });
    const table = await teamsTable();
    expect(aliasOrder(table)).toEqual(["Alpha", "Beta", "Gamma"]);
    const readsOf = () =>
      calls.filter((c) => c.path === "/api/litellm/team-links").length;
    extra.litellmTeams = [
      { litellmTeamId: "ll-4", alias: "Delta" },
      ...SHUFFLED,
    ];
    window.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(readsOf()).toBe(2));
    await waitFor(() =>
      expect(aliasOrder(table)).toEqual(["Alpha", "Beta", "Delta", "Gamma"]),
    );
    expect(
      within(table).getByRole("columnheader", { name: "LiteLLM team" }),
    ).toHaveAttribute("aria-sort", "ascending");
  });
});
