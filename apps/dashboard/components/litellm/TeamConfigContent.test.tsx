import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiError, apiResponse } from "@/test/api-stubs";
import { renderWithProviders } from "@/test/render-providers";

import { TeamConfigContent } from "./TeamConfigContent";

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
// Contract for the developer (components/litellm/TeamConfigContent.tsx):
//   props { canRaiseLimits: boolean } (server-computed: Admin / org-admin).
//   Teams come from GET /api/litellm/me; only `teams[].configurable === true`
//   are listed (a new optional boolean on the me team ref; absent = false).
//   Selected team: ?team= (nuqs) when configurable, else the first one.
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

type Call = { method: string; path: string; body: unknown };
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
      const path = new URL(String(input), "http://localhost").pathname;
      const method = init?.method ?? "GET";
      const body =
        typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ method, path, body });
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
    <TeamConfigContent canRaiseLimits={canRaiseLimits} />,
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

describe("TeamConfigContent team picker (Team configuration page)", () => {
  it("lists only the caller's configurable teams (Who: teams in scope)", async () => {
    stub();
    renderConfig();
    const picker = await screen.findByRole("combobox", { name: "Team" });
    const names = within(picker)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(names).toEqual(["Payments", "Risk"]);
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

describe("TeamConfigContent sections (Design System -- LiteLLM Page)", () => {
  it("renders Members, Keys, Budget and limits and Models, each its own region", async () => {
    stub();
    renderConfig();
    for (const name of ["Members", "Keys", "Budget and limits", "Models"]) {
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

describe("TeamConfigContent operation gating (Team configuration page: each control only when its operation is enabled)", () => {
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

describe("TeamConfigContent destructive actions (Design System: AlertDialog confirms)", () => {
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

describe("TeamConfigContent generate key (Writes: the key value is shown once)", () => {
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

describe("TeamConfigContent budget, limits and models", () => {
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

describe("TeamConfigContent errors (API routes: error codes)", () => {
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
describe("TeamConfigContent member and key edits", () => {
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
describe("TeamConfigContent add-member picker", () => {
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
