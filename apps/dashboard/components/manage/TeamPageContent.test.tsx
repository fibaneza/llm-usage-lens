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
    <TeamPageContent canRaiseLimits={canRaiseLimits} scopeLabel={null} />,
    { searchParams },
  );
}

const user = () => userEvent.setup({ pointerEventsCheck: 0 });
const region = (name: string) => screen.findByRole("region", { name });

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
  it("labels the team's daily buckets as UTC days (LD20)", async () => {
    stub({
      "GET /api/litellm/teams/t1": () =>
        apiResponse({
          data: {
            ...detailWith(ALL_OPS),
            daily: [{ date: "2026-11-14", spend: 40 }],
          },
        }),
    });
    renderConfig();
    expect(
      within(await region("Team spend & budgets")).getByText(/UTC days?/i),
    ).toBeInTheDocument();
  });

  it("renders key expiry in Australia/Sydney with the zone label (LD20)", async () => {
    stub();
    renderConfig();
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
    const { container } = renderConfig();
    const keys = await region("Keys");
    expect(await within(keys).findByText("ci-key")).toBeInTheDocument();
    expect(within(keys).getByText("$8.40")).toBeInTheDocument();
    expect(within(keys).getByText(/blocked/i)).toBeInTheDocument();
    expect(container.textContent).not.toContain("sk-");
  });
});

describe("TeamPageContent sections (Design System -- LiteLLM Page)", () => {
  it("renders LiteLLM members, Keys, Budget and limits and Models, each its own region (the L4 panel is titled LiteLLM members; the mounted Access sections keep Members)", async () => {
    stub();
    renderConfig();
    for (const name of [
      "LiteLLM members",
      "Keys",
      "Budget and limits",
      "Models",
    ]) {
      expect(await region(name)).toBeInTheDocument();
    }
  });

  it("a failing section does not break the others (Rule 40.4)", async () => {
    stub({ "GET /api/litellm/teams/t1/keys": () => apiError(500) });
    renderConfig();
    const keys = await region("Keys");
    expect(await within(keys).findByRole("alert")).toBeInTheDocument();
    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
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

  it("renders every control when every operation is enabled", async () => {
    stub();
    renderConfig();
    await screen.findByText("Ada Lovelace");
    await screen.findByText("ci-key");
    await screen.findByRole("button", { name: "Save models" });
    for (const [name, find] of controls) {
      expect(find(), name).toBeInTheDocument();
    }
  });

  it("renders only the controls whose operation is enabled", async () => {
    stub({}, ["resetMemberSpend", "blockKey"]);
    renderConfig();
    await screen.findByText("Ada Lovelace");
    await screen.findByText("ci-key");
    const present = controls
      .filter(([, find]) => find() !== null)
      .map(([name]) => name);
    expect(present).toEqual([
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
      renderConfig();
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
    renderConfig();
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
    renderConfig();
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
    const { unmount } = renderConfig(false);
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
    renderConfig(true);
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
    renderConfig();
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
    renderConfig();
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
    renderConfig();
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
      renderConfig();
      const budget = await screen.findByLabelText("Max budget (USD)");
      await u.clear(budget);
      await u.type(budget, "100");
      await u.click(screen.getByRole("button", { name: "Save budget" }));
      const budgetRegion = await region("Budget and limits");
      expect(await within(budgetRegion).findByRole("alert")).toHaveTextContent(
        message,
      );
      // The page stays up.
      expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
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
    renderConfig();
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
    renderConfig();
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
    renderConfig();
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
// Rules 40.4, 60.12. These also carry the live cases moved from
// LiteLLMContent.test.tsx (Team tab).
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

describe("TeamPageContent team spend and budget (Management pages - Team usage)", () => {
  it("has a 'Team spend & budgets' region with the LiteLLM-reported label, USD, UTC-day label and a BudgetBar", async () => {
    stub();
    renderConfig();
    const spend = await region("Team spend & budgets");

    expect(
      within(spend).getAllByText("LiteLLM-reported").length,
    ).toBeGreaterThan(0);
    expect(await within(spend).findByText("$321.75")).toBeInTheDocument();
    expect(within(spend).getByText("$500.00")).toBeInTheDocument();
    expect(within(spend).getByText("$400.00")).toBeInTheDocument();
    expect(within(spend).getByText(/UTC days?/i)).toBeInTheDocument();
    expect(within(spend).getByRole("progressbar")).toHaveAttribute(
      "data-state",
      "neutral",
    );
    expect(within(spend).getByText("64%")).toBeInTheDocument();
  });

  // Q1 (LiteLLM spec LD36): "Spend" is the selected range, i.e. the sum of the
  // daily rows; team_info.spend (budget period) shows only beside the budget.
  it("Q1: the 'Spend' figure is the range spend (sum of the daily rows); the budget-period spend appears only as 'Spent this budget period' (LD36)", async () => {
    stub({
      "GET /api/litellm/teams/t1": okData({
        ...detailWith(ALL_OPS),
        daily: [
          { date: "2026-11-02", spend: 1.5 },
          { date: "2026-11-03", spend: 2 },
        ],
      }),
    });
    renderConfig();
    const spend = await region("Team spend & budgets");

    const card = await within(spend).findByRole("group", { name: "Spend" });
    expect(within(card).getByText("$3.50")).toBeInTheDocument();
    expect(card.textContent).not.toContain("$321.75");
    expect(
      within(spend).getByText("Spent this budget period"),
    ).toBeInTheDocument();
    expect(within(spend).getByText("$321.75")).toBeInTheDocument();
  });

  it("labels LiteLLM members and Keys spend as LiteLLM-reported too (LT8)", async () => {
    stub();
    renderConfig();
    for (const name of ["LiteLLM members", "Keys"]) {
      expect(
        within(await region(name)).getAllByText("LiteLLM-reported").length,
      ).toBeGreaterThan(0);
    }
  });

  it("switching the team selector re-reads the team spend for the picked team", async () => {
    stub({
      "GET /api/litellm/teams/t2": okData({
        ...detailWith(ALL_OPS),
        team: { ...detailWith(ALL_OPS).team, alias: "Risk", spend: 9.99 },
      }),
    });
    renderConfig();
    await userEvent.selectOptions(
      await screen.findByRole("combobox", { name: "Team" }),
      "Risk",
    );

    expect(
      await within(await region("Team spend & budgets")).findByText("$9.99"),
    ).toBeInTheDocument();
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
    const { container } = renderConfig();
    const keys = await region("Keys");

    // 2026-12-01T13:00:00Z is 2026-12-02 00:00 in AEDT.
    expect(
      await within(keys).findByText(/2 Dec 2026,? 00:00 AEDT/),
    ).toBeInTheDocument();
    expect(container.textContent).not.toContain(SENTINEL_KEY_VALUE);
  });
});

describe("TeamPageContent states (Design System - LiteLLM Page: States)", () => {
  // Superseded 2026-11-17 (App Teams - Spend source): an unlinked team no
  // longer shows "not connected to LiteLLM" as an empty state; it shows the
  // member sum (see "TeamPageContent spend source" below).
  it("an unlinked team no longer shows the 'not connected to LiteLLM' empty state (App Teams - Spend source)", async () => {
    stub({
      "GET /api/litellm/me": okData(unlinkedMe),
      "GET /api/litellm/teams/t1": okData(unlinkedDetail),
    });
    renderConfig();
    await region("Team spend");
    expect(screen.queryByText(/not connected to LiteLLM/i)).toBeNull();
  });

  it("shows 'LiteLLM unavailable' in each team section when the team routes return 503, keeping the page up", async () => {
    stub({
      "GET /api/litellm/teams/t1": unavailable,
      "GET /api/litellm/teams/t1/members": unavailable,
      "GET /api/litellm/teams/t1/keys": unavailable,
    });
    renderConfig();

    for (const name of ["Team spend & budgets", "LiteLLM members", "Keys"]) {
      expect(
        await within(await region(name)).findByText(/LiteLLM unavailable/i),
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
    renderConfig();

    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
    expect(await screen.findByText("ci-key")).toBeInTheDocument();
    for (const name of WRITE_CONTROLS) {
      expect(
        screen.queryByRole("button", { name }),
        name,
      ).not.toBeInTheDocument();
    }
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

// ---- L4b: app-team spend (docs/specs/2026-11-17-app-teams.md - UI) ------------
//
// Contract for the developer (TeamPageContent / TeamSpendPanel):
//   GET /api/litellm/teams/[id] is read with include=memberSum (the server
//   ignores it for a Lead, ATT6). The panel renders from the response:
//   - connected: the "Team spend & budgets" region as today, plus a source
//     badge "LiteLLM team" beside the headline. Only when `memberSum` is in the
//     response (Admin, org-admin, Auditor) a second figure titled "Sum of
//     members" and the "Why the figures differ" text.
//   - not connected (spendSource "member-sum"): a region named "Team spend"
//     (no budgets), source badge "Sum of members", headline = memberSum.total,
//     the coverage line "<members> members: <matched> matched, <unmatched> not
//     in LiteLLM, <pending> pending", the daily table, a member table (name,
//     spend; "not in LiteLLM" instead of a spend for an unmatched member; no
//     spend cell value when the Organisation cap omits it) and the one-line
//     text "This team has no LiteLLM team of its own. Budgets, limits and keys
//     are managed in LiteLLM.". No LiteLLM panel (members, keys, budget and
//     limits, models) and no call to those routes. The server-rendered `access`
//     slot (app membership add/remove) still mounts.
const unlinkedMe = {
  linked: false,
  enabledOperations: ["getUserDailySpend"],
  teams: [
    { teamId: "t1", teamName: "Payments", linked: false, configurable: true },
  ],
};
const MEMBER_SUM = {
  total: 4,
  daily: [
    { date: "2026-11-02", spend: 2 },
    { date: "2026-11-03", spend: 2 },
  ],
  coverage: { members: 3, matched: 2, unmatched: 1, pending: 1 },
  members: [
    { oid: "oid-u1", name: "Una One", matched: true, spend: 3.5 },
    { oid: "oid-u2", name: "Dos Two", matched: true, spend: 0.5 },
    { oid: "oid-u3", name: "Tres Three", matched: false },
  ],
};
const unlinkedDetail = {
  connected: false,
  spendSource: "member-sum",
  daily: MEMBER_SUM.daily,
  memberSum: MEMBER_SUM,
};
const SENTENCE =
  "This team has no LiteLLM team of its own. Budgets, limits and keys are managed in LiteLLM.";
const LITELLM_PANELS = [
  "LiteLLM members",
  "Keys",
  "Budget and limits",
  "Models",
];

function stubUnlinked(detail: unknown = unlinkedDetail) {
  return stub({
    "GET /api/litellm/me": okData(unlinkedMe),
    "GET /api/litellm/teams/t1": okData(detail),
  });
}

describe("TeamPageContent spend source - unlinked team (App Teams: Spend source, UI)", () => {
  it("shows the member sum as the headline with the 'Sum of members' badge, the LiteLLM-reported label and the UTC days", async () => {
    stubUnlinked();
    renderConfig();
    const spend = await region("Team spend");
    expect(await within(spend).findByText("$4.00")).toBeInTheDocument();
    expect(within(spend).getAllByText("Sum of members").length).toBeGreaterThan(
      0,
    );
    expect(
      within(spend).getAllByText("LiteLLM-reported").length,
    ).toBeGreaterThan(0);
    expect(within(spend).getByText("2026-11-02")).toBeInTheDocument();
    expect(within(spend).getByText(/UTC days?/i)).toBeInTheDocument();
  });

  it("states the coverage: members, matched, not in LiteLLM and pending", async () => {
    stubUnlinked();
    renderConfig();
    const spend = await region("Team spend");
    const line = await within(spend).findByText(/2 matched/);
    for (const part of [/3 members/, /1 not in LiteLLM/, /1 pending/]) {
      expect(line.textContent).toMatch(part);
    }
  });

  it("lists each member with spend; an unmatched member reads 'not in LiteLLM', never $0 (Member sum step 4)", async () => {
    stubUnlinked();
    renderConfig();
    const spend = await region("Team spend");
    const una = await within(spend).findByRole("row", { name: /Una One/ });
    expect(within(una).getByText("$3.50")).toBeInTheDocument();
    expect(
      within(within(spend).getByRole("row", { name: /Dos Two/ })).getByText(
        "$0.50",
      ),
    ).toBeInTheDocument();
    const lost = within(spend).getByRole("row", { name: /Tres Three/ });
    expect(within(lost).getByText(/not in LiteLLM/i)).toBeInTheDocument();
    expect(lost.textContent).not.toContain("$");
  });

  it("shows no per-member spend while the Organisation cap omits it, but still the total (AT3)", async () => {
    stubUnlinked({
      ...unlinkedDetail,
      memberSum: {
        ...MEMBER_SUM,
        members: MEMBER_SUM.members.map(({ oid, name, matched }) => ({
          oid,
          name,
          matched,
        })),
      },
    });
    renderConfig();
    const spend = await region("Team spend");
    expect(await within(spend).findByText("$4.00")).toBeInTheDocument();
    const una = within(spend).getByRole("row", { name: /Una One/ });
    expect(una.textContent).not.toContain("$");
  });

  it("says in one line that the team has no LiteLLM team of its own", async () => {
    stubUnlinked();
    renderConfig();
    expect(await screen.findByText(SENTENCE)).toBeInTheDocument();
  });

  it("renders no LiteLLM panel or control and calls none of the team's L4 routes (AT4)", async () => {
    const api = stubUnlinked();
    renderWithProviders(
      <TeamPageContent
        canRaiseLimits
        scopeLabel={null}
        access={<section aria-label="Members">app members</section>}
      />,
    );
    await region("Team spend");
    for (const name of LITELLM_PANELS) {
      expect(screen.queryByRole("region", { name }), name).toBeNull();
    }
    for (const name of [
      "Add member",
      "Generate key",
      "Save budget",
      "Save limits",
      "Save models",
      "Reset spend for all members",
    ]) {
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

  it("shows 'LiteLLM unavailable' in the spend region when the member reads fail with 503, keeping the page up (AT7)", async () => {
    stub({
      "GET /api/litellm/me": okData(unlinkedMe),
      "GET /api/litellm/teams/t1": unavailable,
    });
    renderConfig();
    expect(
      await within(await region("Team spend")).findByText(
        /LiteLLM unavailable/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Team" })).toBeInTheDocument();
  });

  it("a team above the member cap shows the route's message in the spend region, not a crash (AT6)", async () => {
    stub({
      "GET /api/litellm/me": okData(unlinkedMe),
      "GET /api/litellm/teams/t1": () =>
        apiError(
          422,
          "TOO_MANY_MEMBERS",
          "This team has more than 200 members",
        ),
    });
    renderConfig();
    const spend = await region("Team spend");
    expect(
      await within(spend).findByText(/more than 200 members/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Team" })).toBeInTheDocument();
  });
});

describe("TeamPageContent spend source - linked team (App Teams: Spend source, UI; AT1, ATT6)", () => {
  const withMemberSum = {
    ...detailWith(ALL_OPS),
    memberSum: { ...MEMBER_SUM, total: 2.25, daily: [] },
  };

  it("only the spend section's team read sends include=memberSum; the L4 panels' reads do not; the server decides who gets it (ATT6, AT6)", async () => {
    const api = stub();
    renderConfig();
    await region("Team spend & budgets");
    const includes = api.calls
      .filter((c) => c.path === "/api/litellm/teams/t1")
      .map((c) => new URLSearchParams(c.search).get("include"));
    expect(includes).toContain("memberSum");
    expect(includes).toContain(null);
    for (const include of includes) {
      expect([null, "memberSum"]).toContain(include);
    }
  });

  it("a Lead's response has no member sum: the 'LiteLLM team' badge, the team figure and no second figure", async () => {
    stub();
    renderConfig();
    const spend = await region("Team spend & budgets");
    expect(await within(spend).findByText("$321.75")).toBeInTheDocument();
    expect(within(spend).getByText("LiteLLM team")).toBeInTheDocument();
    expect(within(spend).queryByText("Sum of members")).toBeNull();
    expect(within(spend).queryByText(/figures? differ/i)).toBeNull();
  });

  it("with a member sum in the response (Admin, org-admin, Auditor) a second figure 'Sum of members' appears next to the team figure with the 'Why the figures differ' text", async () => {
    stub({ "GET /api/litellm/teams/t1": okData(withMemberSum) });
    renderConfig();
    const spend = await region("Team spend & budgets");
    expect(await within(spend).findByText("$321.75")).toBeInTheDocument();
    expect(within(spend).getByText("LiteLLM team")).toBeInTheDocument();
    expect(within(spend).getByText("Sum of members")).toBeInTheDocument();
    expect(within(spend).getByText("$2.25")).toBeInTheDocument();
    const text = spend.textContent ?? "";
    expect(text).toMatch(/spent through that LiteLLM team's keys/i);
    expect(text).toMatch(/each app member spent through the gateway/i);
    expect(text).toMatch(/personal keys/i);
  });
});
