import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiError, apiResponse } from "@/test/fakes/api-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { TeamPageContent } from "./TeamPageContent";

// Sources: docs/specs/2026-11-10-litellm.md -- "Team configuration page (L4)"
// (team picker + ?team= deep link via nuqs; members, keys, team budget and
// limits, team models; each control only when its operation is enabled),
// LD25, "Budgets and limits" (a Lead lowers only; the API enforces),
// "Writes" (generateMemberKey: the key value is shown once); Design System --
// LiteLLM Page (sections Members, Keys, Budget and limits, Models; AlertDialog
// confirms for remove / reset spend / delete key; shown-once key dialog with
// copy and a "you will not see this again" note); Rules 40.4, 60.12, 60.24a.
// Component tests assert rendering and the request made; the routes' own
// scoping, toggles, audit and validation are tested with the routes.
//
// Moved from components/litellm/TeamConfigContent.test.tsx (slice B2, B2-4:
// the interim team-config page is gone; the Team page mounts the same L4
// panels, so every case below still covers live behaviour). Changes: the
// picker now lists every team in /api/litellm/me `teams` (a lead's list holds
// only teams it leads, server-scoped; the read-only auditor and a non-
// configurable team are listed too), and the read-only cases at the end are
// new. The tab-row cases of LiteLLMContent.test.tsx were dropped with the tab
// row; the read sections it covered moved to the second half of this file.
//
// Contract for the developer (components/manage/TeamPageContent.tsx, "use client"):
//   props { canRaiseLimits: boolean; scopeLabel: string | null;
//   access?: ReactNode } (server-computed: Admin only raises; the scope label
//   from scopeLabelFor; the server-rendered team-level access sections).
//   Teams come from GET /api/litellm/me `teams` (all of them).
//   Selected team: ?team= (nuqs) when listed, else the first one.
//   Per team it reads /teams/[id] (enabledOperations, team limits),
//   /teams/[id]/members, /teams/[id]/keys and /api/litellm/models, and writes
//   through the routes in the LiteLLM spec -- API routes table. Accessible
//   names are those used below. Every write refetches (invalidates) the
//   section's read; failures show the server `message` in a role="alert".
const NEW_KEY = "sk-NEW-KEY-SHOWN-ONCE";

const ALL_OPS = [
  "addTeamMember",
  "removeTeamMember",
  "setMemberBudget",
  "setMemberLimits",
  "resetMemberSpend",
  "requestBudgetReset",
  "resetMemberBudget",
  "disableMember",
  "enableMember",
  "generateMemberKey",
  "updateMemberKey",
  "blockKey",
  "unblockKey",
  "deleteKey",
  "rotateKey",
  "setTeamBudget",
  "setTeamLimits",
  "setTeamModels",
];

const meWith = (ops: string[]) => ({
  linked: false,
  enabledOperations: ops,
  teams: [
    { teamId: "t1", teamName: "Payments", linked: true, configurable: true },
    { teamId: "t2", teamName: "Risk", linked: true, configurable: true },
    { teamId: "t3", teamName: "Ops", linked: true, configurable: false },
  ],
});

const detailWith = (ops: string[]) => ({
  connected: true,
  spendSource: "litellm-team",
  team: {
    alias: "Payments",
    spend: 321.75,
    maxBudget: 500,
    softBudget: 400,
    budgetDuration: "30d",
    models: ["claude-sonnet", "claude-haiku"],
    rpmLimit: 100,
    tpmLimit: 20000,
  },
  daily: [],
  enabledOperations: ops,
});

const CANDIDATES = [
  { oid: "oid-bob", name: "Bob Builder", email: "bob@example.test" },
  { oid: "oid-cy", name: "Cy Poe", email: "cy@example.test" },
];

const MEMBERS = {
  connected: true,
  candidates: CANDIDATES,
  items: [
    {
      userId: "u-ada",
      oid: "oid-ada",
      name: "Ada Lovelace",
      email: "ada@example.test",
      spend: 77.1,
      maxBudget: 150,
      rpmLimit: null,
      tpmLimit: null,
    },
  ],
};

const KEYS = {
  connected: true,
  items: [
    {
      tokenId: "tok-1",
      keyAlias: "ci-key",
      models: ["claude-haiku"],
      maxBudget: 50,
      spend: 8.4,
      expires: "2026-12-01T13:00:00Z",
      blocked: false,
    },
  ],
};

type Call = { method: string; path: string; body: unknown; search: string };
type Handler = (body: unknown) => Response;

// Stubbed same-origin fetch keyed by "METHOD path" (Rule 60.24: no network).
function stub(overrides: Record<string, Handler> = {}, ops = ALL_OPS) {
  const calls: Call[] = [];
  const ok = (data: unknown) => () => apiResponse({ data });
  const routes: Record<string, Handler> = {
    "GET /api/litellm/me": ok(meWith(ops)),
    "GET /api/litellm/teams/t1": ok(detailWith(ops)),
    "GET /api/litellm/teams/t2": ok(detailWith(ops)),
    "GET /api/litellm/teams/t1/members": ok(MEMBERS),
    "GET /api/litellm/teams/t2/members": ok({ connected: true, items: [] }),
    "GET /api/litellm/teams/t1/keys": ok(KEYS),
    "GET /api/litellm/teams/t2/keys": ok({ connected: true, items: [] }),
    "GET /api/litellm/models": ok({
      items: ["claude-sonnet", "claude-haiku", "claude-opus"],
    }),
    // M4: the Budgets view also reads the open reset requests of the team and
    // the scoped reset counts (LiteLLM spec - Budget reset requests, MG-D10).
    "GET /api/budget-reset-requests": ok({ items: [] }),
    "GET /api/budget-resets": ok({
      teams: [],
      own: { count: 0, amount: 0 },
    }),
    ...overrides,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      const path = url.pathname;
      const method = init?.method ?? "GET";
      const body =
        typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ method, path, body, search: url.search });
      const route = routes[`${method} ${path}`];
      if (!route) throw new Error(`unexpected ${method} ${path}`);
      return route(body);
    }),
  );
  const writes = () => calls.filter((c) => c.method !== "GET");
  const gets = (path: string) =>
    calls.filter((c) => c.method === "GET" && c.path === path).length;
  return { calls, writes, gets };
}

function renderConfig(canRaiseLimits = false, searchParams = {}) {
  return renderWithProviders(
    <TeamPageContent
      canRaiseLimits={canRaiseLimits}
      canCreateTeam={false}
      scopeLabel={null}
    />,
    { searchParams },
  );
}

const user = () => userEvent.setup({ pointerEventsCheck: 0 });
const region = (name: string) => screen.findByRole("region", { name });

// Slice B2b (Design System - Management pages, *Team page views and links*):
// the page body is three views on the one Tabs component, ?view= in the URL,
// and only the active view is rendered. Members holds the LiteLLM members and
// the app-membership `access` slot; Budgets holds "Team spend & budgets" and
// "Budget and limits"; Keys holds "Keys" and "Models". Cases that read a panel
// of another view open it with ?view= (renderView) or by clicking its tab.
type View = "members" | "budgets" | "keys";
const renderView = (view: View, canRaiseLimits = false) =>
  renderConfig(canRaiseLimits, { view });
const openTab = async (u: ReturnType<typeof user>, name: string) =>
  u.click(await screen.findByRole("tab", { name }));

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("TeamPageContent team picker (Team configuration page)", () => {
  it("lists the caller's teams as the me route returns them (B2-4: server-scoped, a read-only caller included)", async () => {
    stub();
    renderConfig();
    const picker = await screen.findByRole("combobox", { name: "Team" });
    const names = within(picker)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(names).toEqual(["Payments", "Risk", "Ops"]);
  });

  it("?team= deep links to that team and its sections read that team (Route: nuqs deep link)", async () => {
    const api = stub();
    renderConfig(false, { team: "t2" });
    expect(await screen.findByRole("combobox", { name: "Team" })).toHaveValue(
      "t2",
    );
    await waitFor(() =>
      expect(api.gets("/api/litellm/teams/t2/members")).toBeGreaterThan(0),
    );
    expect(api.gets("/api/litellm/teams/t1/members")).toBe(0);
  });
});

// Moved from the retired LiteLLMContent.test.tsx (LD20, LT8; Keys metadata
// only): the live behaviour of the deleted Keys / Team spend sections.
describe("TeamPageContent time rendering and key metadata (LD20, Keys metadata only)", () => {
  it("renders key expiry in Australia/Sydney with the zone label (LD20)", async () => {
    stub();
    renderView("keys");
    // 2026-12-01T13:00:00Z is 2026-12-02 00:00 in AEDT.
    expect(
      await within(await region("Keys")).findByText(/2 Dec 2026,? 00:00 AEDT/),
    ).toBeInTheDocument();
  });

  it("shows alias, spend and blocked state, never a key value", async () => {
    stub({
      "GET /api/litellm/teams/t1/keys": () =>
        apiResponse({
          data: {
            connected: true,
            items: [{ ...KEYS.items[0], blocked: true }],
          },
        }),
    });
    const { container } = renderView("keys");
    const keys = await region("Keys");
    expect(await within(keys).findByText("ci-key")).toBeInTheDocument();
    expect(within(keys).getByText("$8.40")).toBeInTheDocument();
    expect(within(keys).getByText(/blocked/i)).toBeInTheDocument();
    expect(container.textContent).not.toContain("sk-");
  });
});

describe("TeamPageContent sections (Design System -- LiteLLM Page)", () => {
  it.each([
    ["members", ["LiteLLM members"]],
    ["budgets", ["Budget and limits"]],
    ["keys", ["Keys", "Models"]],
  ] as const)(
    "the %s view renders its sections, each its own region (the L4 panel is titled LiteLLM members; the mounted Access sections keep Members)",
    async (view, names) => {
      stub();
      renderView(view);
      for (const name of names) {
        expect(await region(name)).toBeInTheDocument();
      }
    },
  );

  it("a failing section does not break the others in its view (Rule 40.4)", async () => {
    stub({ "GET /api/litellm/teams/t1/keys": () => apiError(500) });
    renderView("keys");
    const keys = await region("Keys");
    expect(await within(keys).findByRole("alert")).toBeInTheDocument();
    expect(
      await screen.findByRole("checkbox", { name: "claude-haiku" }),
    ).toBeInTheDocument();
  });
});

describe("TeamPageContent operation gating (Team configuration page: each control only when its operation is enabled)", () => {
  const controls: Array<[string, () => HTMLElement | null]> = [
    ["Add member", () => screen.queryByRole("button", { name: "Add member" })],
    [
      "Remove Ada Lovelace",
      () => screen.queryByRole("button", { name: "Remove Ada Lovelace" }),
    ],
    [
      "Reset spend for Ada Lovelace",
      () =>
        screen.queryByRole("button", { name: "Reset spend for Ada Lovelace" }),
    ],
    [
      "Reset budget for Ada Lovelace",
      () =>
        screen.queryByRole("button", { name: "Reset budget for Ada Lovelace" }),
    ],
    [
      "Edit limits for Ada Lovelace",
      () =>
        screen.queryByRole("button", { name: "Edit limits for Ada Lovelace" }),
    ],
    [
      "Generate key",
      () => screen.queryByRole("button", { name: "Generate key" }),
    ],
    [
      "Edit key ci-key",
      () => screen.queryByRole("button", { name: "Edit key ci-key" }),
    ],
    [
      "Unblock key ci-key",
      () => screen.queryByRole("button", { name: "Unblock key ci-key" }),
    ],
    [
      "Rotate key ci-key",
      () => screen.queryByRole("button", { name: "Rotate key ci-key" }),
    ],
    [
      "Block key ci-key",
      () => screen.queryByRole("button", { name: "Block key ci-key" }),
    ],
    [
      "Delete key ci-key",
      () => screen.queryByRole("button", { name: "Delete key ci-key" }),
    ],
    [
      "Save budget",
      () => screen.queryByRole("button", { name: "Save budget" }),
    ],
    [
      "Save limits",
      () => screen.queryByRole("button", { name: "Save limits" }),
    ],
    [
      "Save models",
      () => screen.queryByRole("button", { name: "Save models" }),
    ],
  ];

  // The controls sit in three views (B2b): scan Members, then open Budgets and
  // Keys by their tabs, collecting what each renders.
  async function presentControls() {
    const u = user();
    const found = new Set<string>();
    const scan = () => {
      for (const [name, find] of controls) if (find()) found.add(name);
    };
    await screen.findByText("Ada Lovelace");
    scan();
    await openTab(u, "Budgets");
    await region("Budget and limits");
    scan();
    await openTab(u, "Keys");
    await screen.findByText("ci-key");
    await within(await region("Models")).findAllByText(
      /claude-haiku|switched off/,
    );
    scan();
    return controls.map(([name]) => name).filter((name) => found.has(name));
  }

  it("renders every control when every operation is enabled, across the three views", async () => {
    stub();
    renderConfig();
    expect(await presentControls()).toEqual(controls.map(([name]) => name));
  });

  it("renders only the controls whose operation is enabled", async () => {
    stub({}, ["resetMemberSpend", "blockKey"]);
    renderConfig();
    expect(await presentControls()).toEqual([
      "Reset spend for Ada Lovelace",
      "Block key ci-key",
    ]);
  });
});

describe("TeamPageContent destructive actions (Design System: AlertDialog confirms)", () => {
  it.each([
    [
      "Remove Ada Lovelace",
      "DELETE",
      "/api/litellm/teams/t1/members/oid-ada",
      "GET /api/litellm/teams/t1/members",
    ],
    [
      "Reset spend for Ada Lovelace",
      "POST",
      "/api/litellm/teams/t1/members/oid-ada/reset-spend",
      "GET /api/litellm/teams/t1/members",
    ],
    [
      "Reset budget for Ada Lovelace",
      "POST",
      "/api/litellm/teams/t1/members/oid-ada/reset-budget",
      "GET /api/litellm/teams/t1/members",
    ],
    [
      "Delete key ci-key",
      "DELETE",
      "/api/litellm/teams/t1/keys/tok-1",
      "GET /api/litellm/teams/t1/keys",
    ],
  ])(
    "%s opens an alert dialog and calls the route only after Confirm, then refetches",
    async (button, method, path, readRoute) => {
      const reply: Handler = () => apiResponse({ data: { ok: true } });
      const api = stub({ [`${method} ${path}`]: reply });
      const u = user();
      renderView(button.startsWith("Delete key") ? "keys" : "members");
      await u.click(await screen.findByRole("button", { name: button }));
      const dialog = await screen.findByRole("alertdialog");
      expect(api.writes()).toEqual([]);

      const readPath = readRoute.replace("GET ", "");
      const before = api.gets(readPath);
      await u.click(within(dialog).getByRole("button", { name: "Confirm" }));
      await waitFor(() => expect(api.writes()).toHaveLength(1));
      expect(api.writes()[0]).toMatchObject({ method, path });
      await waitFor(() => expect(api.gets(readPath)).toBeGreaterThan(before));
    },
  );

  it("Cancel closes the dialog without calling the route", async () => {
    const api = stub();
    const u = user();
    renderConfig();
    await u.click(
      await screen.findByRole("button", { name: "Remove Ada Lovelace" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    await u.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(api.writes()).toEqual([]);
  });

  it("a reversible action (block key) calls the route without a confirm dialog", async () => {
    const api = stub({
      "POST /api/litellm/teams/t1/keys/tok-1/block": () =>
        apiResponse({ data: { tokenId: "tok-1", blocked: true } }),
    });
    const u = user();
    renderView("keys");
    await u.click(
      await screen.findByRole("button", { name: "Block key ci-key" }),
    );
    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});

describe("TeamPageContent generate key (Writes: the key value is shown once)", () => {
  const generated = () =>
    apiResponse(
      {
        data: {
          tokenId: "tok-new",
          key: NEW_KEY,
          oid: "oid-ada",
          litellmUserId: "u-ada",
        },
      },
      201,
    );

  it("shows the returned key once with a copy button and the warning; after closing it is gone from the DOM and never re-fetched", async () => {
    const api = stub({ "POST /api/litellm/teams/t1/keys": generated });
    const u = user();
    renderView("keys");
    await u.click(await screen.findByRole("button", { name: "Generate key" }));
    const form = await screen.findByRole("dialog");
    await u.selectOptions(
      within(form).getByRole("combobox", { name: "Key owner" }),
      "oid-ada",
    );
    await u.click(within(form).getByRole("button", { name: "Generate" }));

    const shown = await screen.findByRole("dialog", { name: /key generated/i });
    expect(within(shown).getByText(NEW_KEY)).toBeInTheDocument();
    expect(shown).toHaveTextContent(/you will not see this again/i);
    await u.click(within(shown).getByRole("button", { name: "Copy key" }));
    expect(await navigator.clipboard.readText()).toBe(NEW_KEY);

    const before = api.gets("/api/litellm/teams/t1/keys");
    await u.click(within(shown).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByText(NEW_KEY)).toBeNull());
    expect(document.body.textContent).not.toContain(NEW_KEY);
    // The list refetches (metadata only); generation is never repeated.
    await waitFor(() =>
      expect(api.gets("/api/litellm/teams/t1/keys")).toBeGreaterThan(before),
    );
    expect(api.writes()).toHaveLength(1);
    expect(api.writes()[0]).toMatchObject({
      method: "POST",
      path: "/api/litellm/teams/t1/keys",
      body: { oid: "oid-ada" },
    });
  });
});

describe("TeamPageContent budget, limits and models", () => {
  it("a Lead's budget and limit inputs are bounded to the current value; Admin and org-admin's are not (Budgets and limits: client-side hint only)", async () => {
    stub();
    const { unmount } = renderView("budgets");
    const budget = await screen.findByLabelText("Max budget (USD)");
    expect(budget).toHaveAttribute("max", "500");
    expect(screen.getByLabelText("Requests per minute")).toHaveAttribute(
      "max",
      "100",
    );
    expect(screen.getByLabelText("Tokens per minute")).toHaveAttribute(
      "max",
      "20000",
    );
    unmount();

    stub();
    renderView("budgets", true);
    expect(
      await screen.findByLabelText("Max budget (USD)"),
    ).not.toHaveAttribute("max");
  });

  it("saving the budget sends only the changed field to the budget route", async () => {
    const api = stub({
      "PATCH /api/litellm/teams/t1/budget": () =>
        apiResponse({ data: { teamId: "t1", maxBudget: 300 } }),
    });
    const u = user();
    renderView("budgets");
    const budget = await screen.findByLabelText("Max budget (USD)");
    await u.clear(budget);
    await u.type(budget, "300");
    await u.click(screen.getByRole("button", { name: "Save budget" }));
    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]).toMatchObject({
      method: "PATCH",
      path: "/api/litellm/teams/t1/budget",
      body: { maxBudget: 300 },
    });
  });

  it("offers only the team's current models and saves the checked subset (LD26: narrowing only; LT14)", async () => {
    const api = stub({
      "PUT /api/litellm/teams/t1/models": () =>
        apiResponse({ data: { teamId: "t1", models: ["claude-sonnet"] } }),
    });
    const u = user();
    renderView("keys");
    const haiku = await screen.findByRole("checkbox", { name: "claude-haiku" });
    expect(haiku).toBeChecked();
    // /models lists claude-opus, but the team does not have it: not a choice.
    expect(
      screen.queryByRole("checkbox", { name: "claude-opus" }),
    ).not.toBeInTheDocument();
    await u.click(haiku);
    await u.click(screen.getByRole("button", { name: "Save models" }));
    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]).toMatchObject({
      method: "PUT",
      path: "/api/litellm/teams/t1/models",
      body: { models: ["claude-sonnet"] },
    });
  });

  it("a team that lists no models is offered every /models entry (LD26 fallback)", async () => {
    const detail = detailWith(ALL_OPS);
    stub({
      "GET /api/litellm/teams/t1": () =>
        apiResponse({
          data: { ...detail, team: { ...detail.team, models: [] } },
        }),
    });
    renderView("keys");
    expect(
      await screen.findByRole("checkbox", { name: "claude-opus" }),
    ).toBeInTheDocument();
  });
});

describe("TeamPageContent errors (API routes: error codes)", () => {
  it.each([
    [400, "BAD_REQUEST", "Budget cannot be raised by a Lead"],
    [409, "PRIVILEGED_TARGET", "The target holds a privileged proxy role"],
    [503, "LITELLM_UNAVAILABLE", "LiteLLM is unavailable"],
  ])(
    "a %s %s response shows its message inline",
    async (status, code, message) => {
      stub({
        "PATCH /api/litellm/teams/t1/budget": () =>
          apiError(status, code, message),
      });
      const u = user();
      renderView("budgets");
      const budget = await screen.findByLabelText("Max budget (USD)");
      await u.clear(budget);
      await u.type(budget, "100");
      await u.click(screen.getByRole("button", { name: "Save budget" }));
      const budgetRegion = await region("Budget and limits");
      expect(await within(budgetRegion).findByRole("alert")).toHaveTextContent(
        message,
      );
      // The page stays up (Budgets view only; member rows are not rendered here).
      expect(budgetRegion).toBeInTheDocument();
      expect(screen.getByLabelText("Max budget (USD)")).toBeInTheDocument();
    },
  );
});

// Source: docs/specs/2026-11-10-litellm.md -- "Team configuration page (L4)"
// (members: budget, limits, reset budget; keys: update, unblock, rotate),
// "Writes" (updateMemberKey, rotateKey: the new key value is shown once,
// resetMemberBudget), "Budgets and limits" (only changed fields are sent);
// Design System -- LiteLLM Page (AlertDialog confirms for destructive actions
// -- rotate and reset budget replace or clear state).
describe("TeamPageContent member and key edits", () => {
  const okEmpty = () => apiResponse({ data: { ok: true } });

  it("Edit limits sends only the filled fields: budget to /budget, requests per minute to /limits, no tokens per minute (Writes: setMemberBudget, setMemberLimits)", async () => {
    const api = stub({
      "PATCH /api/litellm/teams/t1/members/oid-ada/budget": okEmpty,
      "PATCH /api/litellm/teams/t1/members/oid-ada/limits": okEmpty,
    });
    const u = user();
    renderConfig();
    await u.click(
      await screen.findByRole("button", {
        name: "Edit limits for Ada Lovelace",
      }),
    );
    const dialog = await screen.findByRole("dialog");
    await u.type(within(dialog).getByLabelText("Member budget (USD)"), "100");
    await u.type(
      within(dialog).getByLabelText("Member requests per minute"),
      "20",
    );
    await u.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.writes()).toHaveLength(2));
    expect(api.writes()).toEqual([
      expect.objectContaining({
        method: "PATCH",
        path: "/api/litellm/teams/t1/members/oid-ada/budget",
        body: { maxBudgetInTeam: 100 },
      }),
      expect.objectContaining({
        method: "PATCH",
        path: "/api/litellm/teams/t1/members/oid-ada/limits",
        body: { rpmLimit: 20 },
      }),
    ]);
  });

  it("Edit limits with only tokens per minute makes no budget call", async () => {
    const api = stub({
      "PATCH /api/litellm/teams/t1/members/oid-ada/limits": okEmpty,
    });
    const u = user();
    renderConfig();
    await u.click(
      await screen.findByRole("button", {
        name: "Edit limits for Ada Lovelace",
      }),
    );
    const dialog = await screen.findByRole("dialog");
    await u.type(
      within(dialog).getByLabelText("Member tokens per minute"),
      "5000",
    );
    await u.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]).toMatchObject({
      path: "/api/litellm/teams/t1/members/oid-ada/limits",
      body: { tpmLimit: 5000 },
    });
  });

  it.each([
    ["setMemberLimits", "Member budget (USD)"],
    ["setMemberBudget", "Member requests per minute"],
  ])(
    "with only %s enabled the Edit limits form omits the other operation's field (operation gating)",
    async (op, absentLabel) => {
      stub({}, [op]);
      const u = user();
      renderConfig();
      await u.click(
        await screen.findByRole("button", {
          name: "Edit limits for Ada Lovelace",
        }),
      );
      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).queryByLabelText(absentLabel)).toBeNull();
    },
  );

  it("Edit key sends only the changed field (maxBudget) to the key route (Writes: updateMemberKey)", async () => {
    const api = stub({
      "PATCH /api/litellm/teams/t1/keys/tok-1": () =>
        apiResponse({ data: { tokenId: "tok-1", maxBudget: 75 } }),
    });
    const u = user();
    renderView("keys");
    await u.click(
      await screen.findByRole("button", { name: "Edit key ci-key" }),
    );
    const dialog = await screen.findByRole("dialog");
    await u.type(within(dialog).getByLabelText("Key budget (USD)"), "75");
    await u.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]).toMatchObject({
      method: "PATCH",
      path: "/api/litellm/teams/t1/keys/tok-1",
      body: { maxBudget: 75 },
    });
  });

  it("Unblock key calls the route without a confirm dialog (reversible)", async () => {
    const api = stub({
      "POST /api/litellm/teams/t1/keys/tok-1/unblock": okEmpty,
    });
    const u = user();
    renderView("keys");
    await u.click(
      await screen.findByRole("button", { name: "Unblock key ci-key" }),
    );
    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("Rotate key confirms first, then shows the new key once and drops it on close (Writes: rotateKey)", async () => {
    const api = stub({
      "POST /api/litellm/teams/t1/keys/tok-1/rotate": () =>
        apiResponse({
          data: { tokenId: "tok-2", previousTokenId: "tok-1", key: NEW_KEY },
        }),
    });
    const u = user();
    renderView("keys");
    await u.click(
      await screen.findByRole("button", { name: "Rotate key ci-key" }),
    );
    const confirm = await screen.findByRole("alertdialog");
    expect(api.writes()).toEqual([]);
    await u.click(within(confirm).getByRole("button", { name: "Confirm" }));

    const shown = await screen.findByRole("dialog", { name: /key generated/i });
    expect(within(shown).getByText(NEW_KEY)).toBeInTheDocument();
    expect(shown).toHaveTextContent(/you will not see this again/i);
    expect(api.writes()).toHaveLength(1);
    expect(api.writes()[0]).toMatchObject({
      method: "POST",
      path: "/api/litellm/teams/t1/keys/tok-1/rotate",
    });

    const before = api.gets("/api/litellm/teams/t1/keys");
    await u.click(within(shown).getByRole("button", { name: "Close" }));
    await waitFor(() =>
      expect(document.body.textContent).not.toContain(NEW_KEY),
    );
    await waitFor(() =>
      expect(api.gets("/api/litellm/teams/t1/keys")).toBeGreaterThan(before),
    );
  });
});

// Source: docs/specs/2026-11-10-litellm.md -- "Team configuration page (L4)"
// (members: add); coordinator decision 2026-11-16: the Add member dialog
// picks from `candidates` returned by GET .../members (dashboard members not
// yet in the LiteLLM team) instead of asking for an object id.
describe("TeamPageContent add-member picker", () => {
  it("Add member opens a dialog with a Member select of the candidates by name and email, and posts { oid }", async () => {
    const api = stub({
      "POST /api/litellm/teams/t1/members": () =>
        apiResponse({ data: { oid: "oid-bob", litellmUserId: "u-bob" } }, 201),
    });
    const u = user();
    renderConfig();
    await u.click(await screen.findByRole("button", { name: "Add member" }));
    const dialog = await screen.findByRole("dialog");
    const select = within(dialog).getByRole("combobox", { name: "Member" });
    const options = within(select).getAllByRole("option");
    expect(options.some((o) => /Bob Builder/.test(o.textContent ?? ""))).toBe(
      true,
    );
    expect(
      options.some((o) => /cy@example\.test/.test(o.textContent ?? "")),
    ).toBe(true);
    await u.selectOptions(select, "oid-bob");
    await u.click(within(dialog).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]).toMatchObject({
      method: "POST",
      path: "/api/litellm/teams/t1/members",
      body: { oid: "oid-bob" },
    });
  });

  it("with no candidates the dialog says everyone is already in LiteLLM and offers no submit", async () => {
    stub({
      "GET /api/litellm/teams/t1/members": () =>
        apiResponse({ data: { ...MEMBERS, candidates: [] } }),
    });
    const u = user();
    renderConfig();
    await u.click(await screen.findByRole("button", { name: "Add member" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(
      "Everyone in this team is already in LiteLLM",
    );
    expect(within(dialog).queryByRole("button", { name: "Add" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// New for the Team page (slice B2, B2-4). Sources: Design System - Management
// pages (Team: PageHeader with the team selector, the ScopeLine for a lead,
// "Usage: team spend ('LiteLLM-reported'), team budget, members, keys'
// metadata, model access"; Budget as a bar; lead team-scoped access sections;
// an unlinked team shows 'not connected'; `internal-auditor` read-only: "a
// control for a disabled operation is absent, not dead"); LiteLLM spec - Cost
// visualisation and provenance (LT8 labels), LD20 (UTC day buckets labelled,
// timestamps in Australia/Sydney), /api/litellm/me date range (Rule 20.8);
// Rules 40.4, 60.12. The Keys, Team spend and time-rendering cases
// below cover the LD20 and LT8 behaviour.
const SENTINEL_KEY_VALUE = "sk-SENTINEL-KEY-VALUE";
const okData = (data: unknown) => () => apiResponse({ data });
const unavailable = () =>
  apiError(503, "LITELLM_UNAVAILABLE", "LiteLLM is unavailable");

describe("TeamPageContent page frame (Management pages - Team)", () => {
  it("opens with a one-line description, no page-level h1, and the team selector", async () => {
    stub();
    const view = renderConfig();
    await screen.findByRole("combobox", { name: "Team" });

    expect(
      view.container.querySelector("p")?.textContent?.trim().length ?? 0,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  });

  it("states a lead's scope with the label and the team names; a global reader gets no scope line (ScopeLine)", async () => {
    stub();
    renderWithProviders(
      <TeamPageContent
        canRaiseLimits={false}
        canCreateTeam={false}
        scopeLabel="Showing teams you lead"
      />,
    );
    expect(
      await screen.findByText(/Showing teams you lead: Payments, Risk/),
    ).toBeInTheDocument();
  });

  it("renders no scope line without a label", async () => {
    stub();
    renderConfig();
    await screen.findByRole("combobox", { name: "Team" });

    expect(screen.queryByText(/Showing /)).not.toBeInTheDocument();
  });

  it("mounts the server-rendered access sections when given", async () => {
    stub();
    renderWithProviders(
      <TeamPageContent
        canRaiseLimits={false}
        canCreateTeam={false}
        scopeLabel={null}
        access={<div data-testid="access-slot" />}
      />,
    );
    expect(await screen.findByTestId("access-slot")).toBeInTheDocument();
  });

  it("without access sections renders no access slot", async () => {
    stub();
    renderConfig();
    await region("LiteLLM members");

    expect(screen.queryByTestId("access-slot")).not.toBeInTheDocument();
  });
});

describe("TeamPageContent Budgets view (Design System - Management pages, Team page views and links; D7)", () => {
  // Design System - Team page views and links: Budgets holds "Budget and
  // limits" and "Spent this budget period" stays beside the budget (LD36);
  // the Where-each-role-reads-team-spend table keeps "Team budget and Spent
  // this budget period" on Team -> Budgets.
  it("the Budgets view holds the Budget and limits panel alone, with the budget-period spend beside the budget (LD36)", async () => {
    stub();
    renderView("budgets");
    const budget = await region("Budget and limits");

    const term = await within(budget).findByText("Spent this budget period");
    expect(term.tagName).toBe("DT");
    expect(term.nextElementSibling?.tagName).toBe("DD");
    expect(term.nextElementSibling).toHaveTextContent("$321.75");
  });

  it("labels LiteLLM members and Keys spend as LiteLLM-reported too (LT8)", async () => {
    stub();
    const u = user();
    renderConfig();
    expect(
      within(await region("LiteLLM members")).getAllByText("LiteLLM-reported")
        .length,
    ).toBeGreaterThan(0);
    await openTab(u, "Keys");
    expect(
      within(await region("Keys")).getAllByText("LiteLLM-reported").length,
    ).toBeGreaterThan(0);
  });
});

describe("TeamPageContent keys and time (LD20, LT8)", () => {
  it("renders key expiry in Australia/Sydney with the zone label, and never a key value", async () => {
    stub({
      "GET /api/litellm/teams/t1/keys": okData({
        connected: true,
        items: [{ ...KEYS.items[0], key: SENTINEL_KEY_VALUE }],
      }),
    });
    const { container } = renderView("keys");
    const keys = await region("Keys");

    // 2026-12-01T13:00:00Z is 2026-12-02 00:00 in AEDT.
    expect(
      await within(keys).findByText(/2 Dec 2026,? 00:00 AEDT/),
    ).toBeInTheDocument();
    expect(container.textContent).not.toContain(SENTINEL_KEY_VALUE);
  });
});

describe("TeamPageContent states (Design System - LiteLLM Page: States)", () => {
  it("shows 'LiteLLM unavailable' in each team section when the team routes return 503, keeping the page up", async () => {
    stub({
      "GET /api/litellm/teams/t1": unavailable,
      "GET /api/litellm/teams/t1/members": unavailable,
      "GET /api/litellm/teams/t1/keys": unavailable,
    });
    const u = user();
    renderConfig();

    // An outage does not hide a view: the tabs follow `configured === false`
    // only (B2b), so each view shows its own "LiteLLM unavailable".
    for (const [tab, name] of [
      ["Members", "LiteLLM members"],
      ["Budgets", "Budget and limits"],
      ["Keys", "Keys"],
    ]) {
      await openTab(u, tab as string);
      expect(
        await within(await region(name as string)).findByText(
          /LiteLLM unavailable/i,
        ),
      ).toBeInTheDocument();
    }
    expect(screen.getByRole("combobox", { name: "Team" })).toBeInTheDocument();
  });

  it("a caller with no teams sees an empty state, not an error", async () => {
    stub({
      "GET /api/litellm/me": okData({
        linked: false,
        enabledOperations: [],
        teams: [],
      }),
    });
    renderConfig();

    expect(await screen.findByText(/no teams/i)).toBeInTheDocument();
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
  });
});

describe("TeamPageContent read-only caller (auditor: write controls absent, read sections shown)", () => {
  const WRITE_CONTROLS = [
    "Add member",
    "Remove Ada Lovelace",
    "Reset spend for Ada Lovelace",
    "Reset budget for Ada Lovelace",
    "Edit limits for Ada Lovelace",
    "Disable Ada Lovelace",
    "Enable Ada Lovelace",
    "Reset spend for all members",
    "Generate key",
    "Edit key ci-key",
    "Rotate key ci-key",
    "Block key ci-key",
    "Unblock key ci-key",
    "Delete key ci-key",
    "Save budget",
    "Save limits",
    "Save models",
  ];

  it("shows members and keys with no write control when no operation is enabled", async () => {
    stub({}, []);
    const u = user();
    renderConfig();

    const noWriteControl = () => {
      for (const name of WRITE_CONTROLS) {
        expect(
          screen.queryByRole("button", { name }),
          name,
        ).not.toBeInTheDocument();
      }
    };
    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
    noWriteControl();
    // The auditor still sees every view it can read (B2b), read-only.
    await openTab(u, "Budgets");
    await region("Budget and limits");
    noWriteControl();
    await openTab(u, "Keys");
    expect(await screen.findByText("ci-key")).toBeInTheDocument();
    noWriteControl();
  });
});

// B4 (LiteLLM spec / Rule 20.8): /api/litellm/me parses DateRangeQuerySchema,
// so the Team page sends the URL range; the global date range applies to every
// Management page (Design System - Management pages).
describe("TeamPageContent /api/litellm/me date range (Rule 20.8, Rule 20.1)", () => {
  function captureMeQueries() {
    const queries: URLSearchParams[] = [];
    stub();
    const base = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), "http://localhost");
        if (url.pathname === "/api/litellm/me") queries.push(url.searchParams);
        return base(input, init);
      }),
    );
    return queries;
  }

  it("sends the URL date range with every me request", async () => {
    const queries = captureMeQueries();
    renderConfig(false, { dateFrom: "2026-11-01", dateTo: "2026-11-14" });
    await region("LiteLLM members");

    expect(queries.length).toBeGreaterThan(0);
    for (const q of queries) {
      expect(q.get("dateFrom")).toBe("2026-11-01");
      expect(q.get("dateTo")).toBe("2026-11-14");
    }
  });

  it("falls back to the default 30-day UTC range when the URL has none", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-14T10:00:00.000Z"));
    try {
      const queries = captureMeQueries();
      renderConfig();
      await region("LiteLLM members");

      expect(queries.length).toBeGreaterThan(0);
      for (const q of queries) {
        expect(q.get("dateFrom")).toBe("2026-10-16");
        expect(q.get("dateTo")).toBe("2026-11-14");
      }
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---- Unlinked teams, LiteLLM not configured, and the removed spend panel ----
//
// Team spend left the Team page for every role and every team state (Design
// System - Management pages, *Team usage (D7)* and *Where each role reads team
// spend*; decided 2026-11-17, user). The page keeps one line for an unlinked
// team (App Teams - Spend source, UI), the access slot, and no LiteLLM panel
// or call for it (AT4); LiteLLM not configured (LD37) leaves the access slot
// alone and no tabs. The figures themselves are tested with TeamSpendPanel.
const unlinkedMe = {
  linked: false,
  enabledOperations: ["getUserDailySpend"],
  teams: [
    { teamId: "t1", teamName: "Payments", linked: false, configurable: true },
  ],
};
const notConfiguredMe = {
  linked: false,
  enabledOperations: [],
  teams: [
    { teamId: "t1", teamName: "Payments", linked: true, configurable: true },
  ],
};
const NOT_CONFIGURED = {
  configured: false,
  connected: true,
  spendSource: "litellm-team",
  daily: [],
};
const SENTENCE =
  "This team has no LiteLLM team of its own. Budgets, limits and keys are managed in LiteLLM.";
const LITELLM_PANELS = [
  "LiteLLM members",
  "Keys",
  "Budget and limits",
  "Models",
];
const L4_WRITE_BUTTONS = [
  "Add member",
  "Generate key",
  "Save budget",
  "Save limits",
  "Save models",
  "Reset spend for all members",
];

function stubUnlinked() {
  return stub({ "GET /api/litellm/me": okData(unlinkedMe) });
}

function stubNotConfigured() {
  return stub({
    "GET /api/litellm/me": okData(notConfiguredMe),
    "GET /api/litellm/teams/t1": okData(NOT_CONFIGURED),
  });
}

// The tabs show while the detail loads and go once it says configured:false.
const settleNotConfigured = async () => {
  await screen.findByRole("combobox", { name: "Team" });
  await waitFor(() => expect(screen.queryByRole("tablist")).toBeNull());
};

describe("TeamPageContent has no Team spend panel for any role or team state (Design System - Team usage D7; Where each role reads team spend)", () => {
  const ROLES = [
    ["internal-admin", { canRaiseLimits: true, canCreateTeam: true }],
    ["internal-org-admin", { canRaiseLimits: false, canCreateTeam: true }],
    [
      "internal-auditor or a lead",
      { canRaiseLimits: false, canCreateTeam: false },
    ],
  ] as const;
  const STATES = [
    ["a linked team", () => stub(), () => region("LiteLLM members")],
    ["an unlinked team", stubUnlinked, () => screen.findByText(SENTENCE)],
    ["LiteLLM not configured", stubNotConfigured, settleNotConfigured],
  ] as const;

  it.each(
    ROLES.flatMap(([role, flags]) =>
      STATES.map(([state, arrange, settle]) => ({
        label: `${role} on ${state}`,
        flags,
        arrange,
        settle,
      })),
    ),
  )(
    "$label: no region named Team spend, no member sum, no include=memberSum read",
    async ({ flags, arrange, settle }) => {
      const api = arrange();
      renderWithProviders(
        <TeamPageContent
          {...flags}
          scopeLabel={null}
          access={<section aria-label="Members">app members</section>}
        />,
      );
      await settle();

      expect(screen.queryByRole("region", { name: /team spend/i })).toBeNull();
      expect(screen.queryByText("Sum of members")).toBeNull();
      expect(screen.queryByText(/figures? differ/i)).toBeNull();
      expect(
        api.calls.filter((c) => c.search.includes("include=memberSum")),
      ).toEqual([]);
    },
  );
});

describe("TeamPageContent unlinked team (App Teams: Spend source, UI; AT4)", () => {
  it("says in one line that the team has no LiteLLM team of its own", async () => {
    stubUnlinked();
    renderConfig();
    expect(await screen.findByText(SENTENCE)).toBeInTheDocument();
  });

  it("renders no LiteLLM panel or control, mounts the access slot, and reads nothing for the team beyond the me route (AT4)", async () => {
    const api = stubUnlinked();
    renderWithProviders(
      <TeamPageContent
        canRaiseLimits
        canCreateTeam={false}
        scopeLabel={null}
        access={<section aria-label="Members">app members</section>}
      />,
    );
    await screen.findByText(SENTENCE);
    for (const name of LITELLM_PANELS) {
      expect(screen.queryByRole("region", { name }), name).toBeNull();
    }
    for (const name of L4_WRITE_BUTTONS) {
      expect(screen.queryByRole("button", { name }), name).toBeNull();
    }
    expect(api.calls.filter((c) => c.path !== "/api/litellm/me")).toEqual([]);
    expect(screen.getByRole("region", { name: "Members" })).toHaveTextContent(
      "app members",
    );
  });
});

describe("TeamPageContent LiteLLM not configured (LD37; Design System - LiteLLM Page, States)", () => {
  it("renders no LiteLLM panel or control and calls none of the team's L4 routes, but still mounts the access slot", async () => {
    const api = stubNotConfigured();
    renderWithProviders(
      <TeamPageContent
        canRaiseLimits
        canCreateTeam={false}
        scopeLabel={null}
        access={<section aria-label="Members">app members</section>}
      />,
    );
    await settleNotConfigured();
    for (const name of LITELLM_PANELS) {
      expect(screen.queryByRole("region", { name }), name).toBeNull();
    }
    for (const name of L4_WRITE_BUTTONS) {
      expect(screen.queryByRole("button", { name }), name).toBeNull();
    }
    const l4 = api.calls.filter(
      (c) => c.path !== "/api/litellm/me" && c.path !== "/api/litellm/teams/t1",
    );
    expect(l4).toEqual([]);
    expect(screen.getByRole("region", { name: "Members" })).toHaveTextContent(
      "app members",
    );
  });
});

// ---- Slice B2b: view tabs (Design System - Management pages, *Team page views
// and links*; Tabs). Contract for the developer (TeamPageContent.tsx):
//   - the one `Tabs` component (components/ui/tabs.tsx), triggers named
//     "Members", "Budgets", "Keys" in that order; state in nuqs `view`
//     (values members | budgets | keys; default members) with history "push"
//     so Back steps through the views;
//   - only the ACTIVE view is rendered (its sections, its reads): Members =
//     "LiteLLM members" + the `access` slot; Budgets = "Budget and limits"
//     alone (team spend moved to Team usage, D7); Keys = "Keys" + "Models";
//   - the tabs show for a linked team unless its detail says configured:false
//     (LD37) - an outage (503) does not hide a tab; an unlinked team or
//     configured:false has only Members: no Budgets/Keys tab, the team spend
//     panel stays above the view, and ?view=budgets|keys falls back to Members;
//   - an unknown ?view= value falls back to Members.
describe("TeamPageContent view tabs (Team page views and links)", () => {
  const tabNames = () =>
    within(screen.getByRole("tablist"))
      .getAllByRole("tab")
      .map((tab) => tab.textContent);
  const accessSlot = <div data-testid="access-slot" />;
  const renderWithAccess = (searchParams: Record<string, string> = {}) =>
    renderWithProviders(
      <TeamPageContent
        canRaiseLimits={false}
        canCreateTeam={false}
        scopeLabel={null}
        access={accessSlot}
      />,
      { searchParams },
    );
  const OTHER_REGIONS = {
    members: ["Budget and limits", "Keys", "Models"],
    budgets: ["LiteLLM members", "Keys", "Models"],
    keys: ["LiteLLM members", "Budget and limits"],
  } as const;

  it("a linked team offers the tabs Members, Budgets, Keys, in that order", async () => {
    stub();
    renderConfig();
    await screen.findByRole("tablist");
    expect(tabNames()).toEqual(["Members", "Budgets", "Keys"]);
  });

  it("opens on Members: the LiteLLM members and the access slot, nothing of the other views, and no request for them", async () => {
    const api = stub();
    renderWithAccess();
    expect(await region("LiteLLM members")).toBeInTheDocument();
    expect(screen.getByTestId("access-slot")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Members" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    for (const name of OTHER_REGIONS.members) {
      expect(screen.queryByRole("region", { name }), name).toBeNull();
    }
    expect(api.gets("/api/litellm/teams/t1/keys")).toBe(0);
    expect(api.gets("/api/litellm/models")).toBe(0);
  });

  it.each([
    ["budgets", "Budgets", ["Budget and limits"]],
    ["keys", "Keys", ["Keys", "Models"]],
  ] as const)(
    "?view=%s opens that view alone: its sections, not the Members view or the access slot",
    async (view, tab, names) => {
      stub();
      renderWithAccess({ view });
      for (const name of names) expect(await region(name)).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: tab })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      for (const name of OTHER_REGIONS[view]) {
        expect(screen.queryByRole("region", { name }), name).toBeNull();
      }
      expect(screen.queryByTestId("access-slot")).toBeNull();
    },
  );

  it("choosing a tab shows its view and writes ?view= to the URL as a history push, so Back steps through the views", async () => {
    stub();
    const onUrlUpdate = vi.fn();
    const u = user();
    renderWithProviders(
      <TeamPageContent
        canRaiseLimits={false}
        canCreateTeam={false}
        scopeLabel={null}
      />,
      { onUrlUpdate },
    );
    await region("LiteLLM members");

    await openTab(u, "Keys");

    expect(await region("Keys")).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "LiteLLM members" }),
    ).toBeNull();
    const update = onUrlUpdate.mock.lastCall?.[0];
    expect(update.searchParams.get("view")).toBe("keys");
    expect(update.options.history).toBe("push");
  });

  it.each(["bogus", "MEMBERS-ish"])(
    "an unknown ?view=%j falls back to Members",
    async (view) => {
      stub();
      renderWithAccess({ view });
      expect(await region("LiteLLM members")).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Members" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(screen.getByTestId("access-slot")).toBeInTheDocument();
    },
  );

  // Review B1: Component Inventory `PageTabs` (label prop -> tablist aria-label).
  // C1 item 8 (B2b review): Design System - Component Inventory, PageTabs;
  // WAI-ARIA tabs: every tab names the panel it controls.
  it("each tab's aria-controls is the id of the one tabpanel (PageTabs; B2b review)", async () => {
    stub();
    renderConfig();
    await screen.findByRole("tablist");
    const panel = await screen.findByRole("tabpanel");
    expect(panel.id).not.toBe("");
    for (const tab of screen.getAllByRole("tab")) {
      expect(tab).toHaveAttribute("aria-controls", panel.id);
    }
  });

  it("the view tablist has the accessible name 'Team views' (PageTabs label; review B1)", async () => {
    stub();
    renderConfig();
    expect(
      await screen.findByRole("tablist", { name: "Team views" }),
    ).toBeInTheDocument();
  });

  // Review B1: Team page views and links -- unlinked / not configured has
  // Members alone, so no Tabs wrapper (no tablist, no tabpanel).
  it("an unlinked team renders no tablist and no tabpanel (review B1)", async () => {
    stubUnlinked();
    renderWithAccess();
    await screen.findByText(SENTENCE);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tabpanel")).toBeNull();
  });

  it("LiteLLM not configured (LD37) renders no tablist and no tabpanel (review B1)", async () => {
    stubNotConfigured();
    renderWithAccess();
    await settleNotConfigured();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tabpanel")).toBeNull();
  });

  it.each(["budgets", "keys"])(
    "an unlinked team has no Budgets or Keys tab and ?view=%s falls back to Members: the one-line text, the access slot, no LiteLLM region (Unlinked rule)",
    async (view) => {
      stubUnlinked();
      renderWithAccess({ view });
      expect(await screen.findByText(SENTENCE)).toBeInTheDocument();
      expect(screen.getByTestId("access-slot")).toBeInTheDocument();
      expect(screen.queryByRole("tab", { name: "Budgets" })).toBeNull();
      expect(screen.queryByRole("tab", { name: "Keys" })).toBeNull();
      for (const name of ["Keys", "Models", "Budget and limits"]) {
        expect(screen.queryByRole("region", { name }), name).toBeNull();
      }
    },
  );

  it.each(["budgets", "keys"])(
    "LiteLLM not configured (LD37) leaves only Members for a linked team too: ?view=%s falls back, the access slot stays, no Budgets or Keys tab",
    async (view) => {
      stubNotConfigured();
      renderWithAccess({ view });
      await settleNotConfigured();
      expect(screen.getByTestId("access-slot")).toBeInTheDocument();
      expect(screen.queryByRole("tab", { name: "Budgets" })).toBeNull();
      expect(screen.queryByRole("tab", { name: "Keys" })).toBeNull();
      expect(screen.queryByRole("region", { name: "Keys" })).toBeNull();
      expect(
        screen.queryByRole("region", { name: "Budget and limits" }),
      ).toBeNull();
    },
  );
});

// ---- Slice B2b, L5b review warning: the shown-once dialog returns focus to the
// button that opened it - Generate key or Rotate - and calls no preventDefault
// when there is no ref to focus (so Radix restores focus itself).
describe("TeamPageContent shown-once key dialog focus (L5b review warning)", () => {
  it("Generate key: closing the dialog returns focus to Generate key", async () => {
    stub({
      "POST /api/litellm/teams/t1/keys": () =>
        apiResponse({ data: { tokenId: "tok-new", key: NEW_KEY } }, 201),
    });
    const u = user();
    renderView("keys");
    await u.click(await screen.findByRole("button", { name: "Generate key" }));
    const form = await screen.findByRole("dialog");
    await u.selectOptions(
      within(form).getByRole("combobox", { name: "Key owner" }),
      "oid-ada",
    );
    await u.click(within(form).getByRole("button", { name: "Generate" }));
    const shown = await screen.findByRole("dialog", { name: /key generated/i });
    await u.click(within(shown).getByRole("button", { name: "Close" }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Generate key" }),
      ).toHaveFocus(),
    );
  });

  it("Rotate: closing the dialog returns focus to that key's Rotate button, even with no Generate key button on the page", async () => {
    stub(
      {
        "POST /api/litellm/teams/t1/keys/tok-1/rotate": () =>
          apiResponse({
            data: { tokenId: "tok-2", previousTokenId: "tok-1", key: NEW_KEY },
          }),
      },
      ["rotateKey"],
    );
    const u = user();
    renderView("keys");
    await u.click(
      await screen.findByRole("button", { name: "Rotate key ci-key" }),
    );
    const confirm = await screen.findByRole("alertdialog");
    await u.click(within(confirm).getByRole("button", { name: "Confirm" }));
    const shown = await screen.findByRole("dialog", { name: /key generated/i });
    await u.click(within(shown).getByRole("button", { name: "Close" }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Rotate key ci-key" }),
      ).toHaveFocus(),
    );
  });
});

// ---- New team (Design System - Management pages, *New team (D5, D6; unit
// M2)*: a New team button for admin and org-admin, absent for everyone else,
// also when the caller has no teams; on success the new team is selected in
// the team picker). The dialog's own behaviour is in TeamCreateDialog.test.tsx.
describe("TeamPageContent New team (D5, D6; unit M2)", () => {
  const CREATED = {
    teamId: "appteam-00000000-0000-4000-8000-000000000001",
    name: "Platform Guild",
    departmentId: "dept-eng",
    departmentName: "Engineering",
    createdBy: "oid-admin",
    createdAt: "2026-11-18T01:00:00.000Z",
    version: 1,
  };
  const noTeams = {
    linked: false,
    enabledOperations: [],
    teams: [],
  };
  const newTeamButton = () =>
    screen.queryByRole("button", { name: "New team" });

  it.each([
    [true, "shows"],
    [false, "does not show"],
  ])(
    "canCreateTeam=%s %s the New team button on a team's page",
    async (can) => {
      stub();
      renderWithProviders(
        <TeamPageContent
          canRaiseLimits={false}
          canCreateTeam={can}
          scopeLabel={null}
        />,
      );
      await screen.findByRole("combobox", { name: "Team" });
      expect(newTeamButton() !== null).toBe(can);
    },
  );

  it.each([
    [true, "shows"],
    [false, "does not show"],
  ])(
    "canCreateTeam=%s %s the New team button when the caller has no teams",
    async (can) => {
      stub({ "GET /api/litellm/me": okData(noTeams) });
      renderWithProviders(
        <TeamPageContent
          canRaiseLimits={false}
          canCreateTeam={can}
          scopeLabel={null}
        />,
      );
      expect(
        await screen.findByText("You have no teams to manage."),
      ).toBeInTheDocument();
      expect(newTeamButton() !== null).toBe(can);
    },
  );

  it("the New team button opens the New team dialog", async () => {
    stub({
      "GET /api/access/org-units": okData({ teams: [], departments: [] }),
    });
    const u = user();
    renderWithProviders(
      <TeamPageContent
        canRaiseLimits={false}
        canCreateTeam
        scopeLabel={null}
      />,
    );
    await u.click(await screen.findByRole("button", { name: "New team" }));
    expect(
      await screen.findByRole("dialog", { name: "New team" }),
    ).toBeInTheDocument();
  });

  it("after a team is created it becomes the selected team: the picker lists it and ?team= holds its id", async () => {
    let created = false;
    stub({
      "GET /api/litellm/me": () =>
        apiResponse({
          data: {
            ...meWith(ALL_OPS),
            teams: [
              ...meWith(ALL_OPS).teams,
              ...(created
                ? [
                    {
                      teamId: CREATED.teamId,
                      teamName: CREATED.name,
                      linked: false,
                      configurable: true,
                    },
                  ]
                : []),
            ],
          },
        }),
      "GET /api/access/org-units": okData({
        teams: [],
        departments: [{ id: "dept-eng", name: "Engineering" }],
      }),
      "POST /api/teams": () => {
        created = true;
        return apiResponse({ data: CREATED }, 201);
      },
    });
    const onUrlUpdate = vi.fn();
    const u = user();
    renderWithProviders(
      <TeamPageContent
        canRaiseLimits={false}
        canCreateTeam
        scopeLabel={null}
      />,
      { onUrlUpdate },
    );
    await u.click(await screen.findByRole("button", { name: "New team" }));
    await screen.findByRole("option", { name: "Engineering" });
    await u.type(
      screen.getByRole("textbox", { name: "Team name" }),
      "Platform Guild",
    );
    await u.selectOptions(
      screen.getByRole("combobox", { name: "Department" }),
      "Engineering",
    );
    await u.click(screen.getByRole("button", { name: "Create team" }));

    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Team" })).toHaveValue(
        CREATED.teamId,
      ),
    );
    expect(
      within(screen.getByRole("combobox", { name: "Team" }))
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toContain("Platform Guild");
    const picked = onUrlUpdate.mock.calls
      .map((c) => c[0].searchParams.get("team"))
      .filter(Boolean);
    expect(picked.at(-1)).toBe(CREATED.teamId);
  });
});

// Unit M4 (LiteLLM spec - Budget reset requests, Flow 3 and MG-D12: "Open
// requests are also listed on the Team page's Budgets view, so a decision never
// depends on the bell"; the Approve AlertDialog names the person and the
// effect; MG-D10 team count; BR7: the reason renders as text; hidden, never
// dead: both resetMemberSpend and requestBudgetReset must be on).
describe("TeamPageContent open budget reset requests (M4; MG-D12)", () => {
  const REQUEST = {
    id: "11111111-1111-4111-8111-111111111111",
    teamId: "t1",
    teamName: "Payments",
    requester: {
      oid: "oid-ada",
      displayName: "Ada Lovelace",
      email: "ada@example.test",
    },
    reason: "Launch week <b>spike</b>",
    status: "open",
    createdAt: "2026-11-14T09:00:00.000Z",
    requestExpiresAt: "2026-11-21T09:00:00.000Z",
    decidedAt: null,
    decidedBy: null,
  };
  const withRequest = {
    "GET /api/budget-reset-requests": () =>
      apiResponse({ data: { items: [REQUEST] } }),
  };
  const listReads = (api: ReturnType<typeof stub>) =>
    api.gets("/api/budget-reset-requests");

  it("lists the open requests of the team with the requester and the reason as plain text (BR7)", async () => {
    stub(withRequest);
    renderView("budgets");
    const section = await screen.findByRole("region", {
      name: /budget reset requests/i,
    });
    expect(within(section).getByText("Ada Lovelace")).toBeInTheDocument();
    expect(
      within(section).getByText("Launch week <b>spike</b>"),
    ).toBeInTheDocument();
    expect(section.querySelector("b")).toBeNull();
  });

  it("an empty list says there are no open requests", async () => {
    stub();
    renderView("budgets");
    expect(await screen.findByText("No open requests.")).toBeInTheDocument();
  });

  it("Approve opens an AlertDialog naming the person, the team and the effect, and sends nothing until confirmed (Flow 3)", async () => {
    const api = stub({
      ...withRequest,
      [`POST /api/budget-reset-requests/${REQUEST.id}/approve`]: () =>
        apiResponse({
          data: {
            request: { ...REQUEST, status: "approved" },
            resetId: "22222222-2222-4222-8222-222222222222",
            amount: 77.1,
          },
        }),
    });
    const u = user();
    renderView("budgets");
    await u.click(await screen.findByRole("button", { name: "Approve" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(
      "Reset Ada Lovelace's spend in Payments to $0. They can spend again at once.",
    );
    expect(api.writes()).toHaveLength(0);
    await u.click(within(dialog).getByRole("button", { name: /approve/i }));
    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]).toMatchObject({
      method: "POST",
      path: `/api/budget-reset-requests/${REQUEST.id}/approve`,
    });
    expect(api.writes()[0]?.body).toBeUndefined();
  });

  it("the list is read again after a decision", async () => {
    const api = stub({
      ...withRequest,
      [`POST /api/budget-reset-requests/${REQUEST.id}/deny`]: () =>
        apiResponse({ data: { request: { ...REQUEST, status: "denied" } } }),
    });
    const u = user();
    renderView("budgets");
    await u.click(await screen.findByRole("button", { name: "Deny" }));
    const dialog = await screen.findByRole("alertdialog");
    const before = listReads(api);
    await u.click(within(dialog).getByRole("button", { name: /deny/i }));
    await waitFor(() => expect(listReads(api)).toBeGreaterThan(before));
    expect(api.writes()[0]).toMatchObject({
      method: "POST",
      path: `/api/budget-reset-requests/${REQUEST.id}/deny`,
    });
  });

  it("a refused approval (409 CONFLICT, 403, LiteLLM failure) shows the server's message in the dialog and keeps the request listed (BR3, BR9)", async () => {
    stub({
      ...withRequest,
      [`POST /api/budget-reset-requests/${REQUEST.id}/approve`]: () =>
        apiError(409, "CONFLICT", "This request was already decided"),
    });
    const u = user();
    renderView("budgets");
    await u.click(await screen.findByRole("button", { name: "Approve" }));
    const dialog = await screen.findByRole("alertdialog");
    await u.click(within(dialog).getByRole("button", { name: /approve/i }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "This request was already decided",
    );
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
  });

  it("a caller with no scope on the team (404 from the list) sees no section and no error", async () => {
    stub({
      "GET /api/budget-reset-requests": () =>
        apiError(404, "NOT_FOUND", "Not found"),
    });
    renderView("budgets");
    await region("Budget and limits");
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: /budget reset requests/i }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([
    ["resetMemberSpend", ALL_OPS.filter((o) => o !== "resetMemberSpend")],
    ["requestBudgetReset", ALL_OPS.filter((o) => o !== "requestBudgetReset")],
  ])(
    "while %s is off the list is hidden and not read (hidden, never dead; MG-D11, MG-D12)",
    async (_off, ops) => {
      const api = stub(withRequest, ops);
      renderView("budgets");
      await region("Budget and limits");
      expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
      expect(listReads(api)).toBe(0);
    },
  );

  it("shows this team's reset count and amount in the range, never another team's (MG-D9, MG-D10, BR10)", async () => {
    stub({
      "GET /api/budget-resets": () =>
        apiResponse({
          data: {
            teams: [
              { teamId: "t1", count: 3, amount: 120 },
              { teamId: "t2", count: 9, amount: 999 },
            ],
            own: { count: 0, amount: 0 },
          },
        }),
    });
    renderView("budgets");
    const budgets = await region("Budget and limits");
    expect(await within(budgets).findByText(/3 resets/)).toHaveTextContent(
      "$120.00",
    );
    expect(within(budgets).queryByText(/9 resets/)).toBeNull();
    expect(within(budgets).queryByText(/\$999/)).toBeNull();
  });

  it("a failed count read hides the count and never breaks the page (MG-D10: supplementary)", async () => {
    stub({
      "GET /api/budget-resets": () => apiError(500, "INTERNAL_ERROR", "boom"),
    });
    renderView("budgets");
    const budgets = await region("Budget and limits");
    expect(
      await screen.findByLabelText("Max budget (USD)"),
    ).toBeInTheDocument();
    expect(within(budgets).queryByText(/resets/i)).toBeNull();
  });
});
