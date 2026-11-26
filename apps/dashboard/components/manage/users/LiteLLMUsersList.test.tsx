import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiError, apiResponse } from "@/test/fakes/api-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { LiteLLMUsersList } from "./LiteLLMUsersList";

const mobile = vi.hoisted(() => ({ on: false }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mobile.on }));

// Source: Design System - Management improvements, LiteLLM users tab (D16a):
// opens on a list, All users or Members of one team, 25 a page from the
// server with no search text; "not in LiteLLM", never $0; per-user cost stays
// hidden under the Organisation cap (LD23); the D16 link states with controls
// only when the list response's mayLink is true (server-computed from the
// caller's effective roles, claims plus in-app ROLEGRANT; coordinator ruling
// F1, 2026-11-18, Access Control - Enforcement), never on the caller's own
// row, and (agent decision 2026-11-18) Create and link follows the list
// response's enabledOperations, so on Enterprise (createUser absent) the row
// says to sign in to LiteLLM once. Route and cost logic are tested in the route's file.
const ME = {
  oid: "oid-me",
  email: "me@example.com",
  roles: ["internal-admin"],
  usageIdentities: [],
  global: true,
  memberTeamId: null,
  memberTeamVisible: false,
  teamScopes: [],
  departmentScopes: [],
};

const ROW_LINKED = {
  key: "oid-ada",
  linkState: "linked",
  appUser: {
    oid: "oid-ada",
    displayName: "Ada Lovelace",
    email: "ada@example.com",
    version: 2,
  },
  litellmUser: {
    userId: "ll-ada",
    email: "ada@example.com",
    spend: 12.5,
    maxBudget: 100,
    teams: [{ teamId: "t1", teamName: "Payments" }],
  },
};
const ROW_NONE = {
  key: "oid-bob",
  linkState: "none",
  appUser: {
    oid: "oid-bob",
    displayName: "Bob Barker",
    email: "bob@example.com",
    version: 0,
  },
  litellmUser: null,
};
const ROW_OWN = {
  ...ROW_NONE,
  key: "oid-me",
  appUser: { ...ROW_NONE.appUser, oid: "oid-me", displayName: "Me Myself" },
};

type Options = {
  me?: Partial<typeof ME>;
  users?: unknown[];
  hasMore?: boolean;
  enabledOperations?: string[];
  // undefined omits the field from the response (fail closed).
  mayLink?: boolean | undefined;
  memberships?: unknown[];
  // Rows GET /api/litellm/users?q= answers: the search shape, as the route
  // returns it (LiteLLMUserSearchResponseSchema), not the list shape.
  search?: unknown[];
  // GET /api/litellm/org: the LiteLLM teams (listTeams), linked or not.
  litellmTeams?: unknown[];
  // GET /api/litellm/proxy-teams/[id]/members items.
  proxyMembers?: unknown[];
  // enabledOperations the proxy-team members read answers (default: member reset on).
  proxyOps?: string[];
  detail?: unknown;
  // The caller's own LiteLLM user id, as the search response carries it
  // (LiteLLMUserSearchResponseSchema.callerLitellmUserId; null = not linked).
  callerLitellmUserId?: string | null;
};

const SEARCH_ROW = {
  userId: "ll-ada",
  email: "ada@example.com",
  spend: 12.5,
  maxBudget: 100,
  teams: [{ teamId: "t1", teamName: "Payments" }],
};
const LITELLM_TEAMS = [
  {
    litellmTeamId: "ll-team-alpha",
    alias: "Alpha",
    spend: 10,
    maxBudget: null,
    memberCount: 3,
    linkedAppTeam: { teamId: "team-a", teamName: "Team A" },
  },
  {
    litellmTeamId: "ll-team-shared",
    alias: "Shared platform",
    spend: 4,
    maxBudget: null,
    memberCount: 2,
    linkedAppTeam: null,
  },
];

function stub(options: Options = { mayLink: true }) {
  const mayLink = "mayLink" in options ? options.mayLink : true;
  const urls: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      urls.push(url);
      if (url.pathname === "/api/me") {
        return Promise.resolve(apiResponse({ data: { ...ME, ...options.me } }));
      }
      if (url.pathname === "/api/access/org-units") {
        return Promise.resolve(
          apiResponse({
            data: {
              departments: [],
              teams: [
                { id: "team-a", name: "Team A", departmentId: "d" },
                { id: "team-u", name: "Team U", departmentId: "d" },
              ],
            },
          }),
        );
      }
      if (url.pathname === "/api/litellm/org") {
        return Promise.resolve(
          apiResponse({
            data: {
              configured: true,
              totals: { spend: 14 },
              daily: [],
              litellmTeams: options.litellmTeams ?? LITELLM_TEAMS,
              appTeams: [
                {
                  teamId: "team-u",
                  teamName: "Team U",
                  spendSource: "member-sum",
                  spend: 1,
                },
              ],
              enabledOperations: [],
            },
          }),
        );
      }
      if (/^\/api\/litellm\/proxy-teams\/[^/]+\/members$/.test(url.pathname)) {
        return Promise.resolve(
          apiResponse({
            data: {
              litellmTeamId: url.pathname.split("/")[4],
              enabledOperations: options.proxyOps ?? [
                "getTeam",
                "resetMemberSpend",
              ],
              items: options.proxyMembers ?? [],
            },
          }),
        );
      }
      if (
        url.pathname === "/api/litellm/users" &&
        url.searchParams.has("q") &&
        !url.searchParams.has("team")
      ) {
        return Promise.resolve(
          apiResponse({
            data: {
              users: options.search ?? [SEARCH_ROW],
              page: Number(url.searchParams.get("page") ?? 1),
              pageSize: 25,
              callerLitellmUserId: options.callerLitellmUserId ?? null,
              enabledOperations: options.enabledOperations ?? ["createUser"],
              ...(mayLink === undefined ? {} : { mayLink }),
            },
          }),
        );
      }
      if (/^\/api\/litellm\/users\/[^/]+$/.test(url.pathname)) {
        return Promise.resolve(
          apiResponse({
            data: options.detail ?? {
              userId: url.pathname.split("/")[4],
              email: "ada@example.com",
              spend: 12.5,
              maxBudget: 100,
              daily: [],
              enabledOperations: [],
            },
          }),
        );
      }
      if (url.pathname === "/api/litellm/users") {
        return Promise.resolve(
          apiResponse({
            data: {
              users: options.users ?? [ROW_LINKED, ROW_NONE],
              page: Number(url.searchParams.get("page") ?? 1),
              pageSize: 25,
              hasMore: options.hasMore ?? false,
              enabledOperations: options.enabledOperations ?? ["createUser"],
              ...(mayLink === undefined ? {} : { mayLink }),
            },
          }),
        );
      }
      if (url.pathname.endsWith("/memberships")) {
        return Promise.resolve(
          apiResponse({ data: { items: options.memberships ?? [] } }),
        );
      }
      return Promise.resolve(apiError(404, "NOT_FOUND"));
    }),
  );
  return {
    listUrls: () => urls.filter((u) => u.pathname === "/api/litellm/users"),
    urls,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LiteLLMUsersList (D16a)", () => {
  it("opens on the all-users list, page 1 of 25, with no search text", async () => {
    const calls = stub();
    renderWithProviders(<LiteLLMUsersList />);
    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
    const first = calls.listUrls()[0];
    expect(first?.searchParams.get("page")).toBe("1");
    expect(first?.searchParams.get("pageSize")).toBe("25");
    expect(first?.searchParams.has("q")).toBe(false);
    expect(first?.searchParams.has("team")).toBe(false);
    expect(screen.getByRole("radio", { name: "All users" })).toBeChecked();
  });

  it("Next requests page 2 from the server; Previous is disabled on page 1", async () => {
    const calls = stub({ hasMore: true });
    renderWithProviders(<LiteLLMUsersList />);
    await screen.findByText("Ada Lovelace");
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    await userEvent.setup().click(screen.getByRole("button", { name: "Next" }));
    await vi.waitFor(() =>
      expect(
        calls.listUrls().some((u) => u.searchParams.get("page") === "2"),
      ).toBe(true),
    );
  });

  it("Members of one team asks for that team only once one is chosen (D-LF3: a linked LiteLLM team asks by its app team)", async () => {
    const calls = stub();
    renderWithProviders(<LiteLLMUsersList />);
    await screen.findByText("Ada Lovelace");
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("radio", { name: "Members of one team" }),
    );
    expect(
      await screen.findByText("Choose a team to list its members"),
    ).toBeInTheDocument();
    await user.selectOptions(await screen.findByLabelText("Team"), "Alpha");
    await vi.waitFor(() =>
      expect(
        calls.listUrls().some((u) => u.searchParams.get("team") === "team-a"),
      ).toBe(true),
    );
  });

  it("a person not in LiteLLM reads 'Not in LiteLLM', never $0 (D16a)", async () => {
    stub({ users: [ROW_NONE] });
    renderWithProviders(<LiteLLMUsersList />);
    const row = (await screen.findByText("Bob Barker")).closest("tr");
    expect(row).not.toBeNull();
    expect(
      within(row as HTMLElement).getAllByText("Not in LiteLLM"),
    ).toHaveLength(2);
    expect(row).not.toHaveTextContent(/\$\s*0/);
  });

  it("hides per-user cost under the Organisation cap: no figure, no $0 (LD23)", async () => {
    const capped = {
      userId: "ll-ada",
      email: "ada@example.com",
      teams: [{ teamId: "t1", teamName: "Payments" }],
    };
    stub({ users: [{ ...ROW_LINKED, litellmUser: capped }] });
    renderWithProviders(<LiteLLMUsersList />);
    const row = (await screen.findByText("Ada Lovelace")).closest("tr");
    expect(row).not.toHaveTextContent(/\$/);
  });

  it("shows the LiteLLM-reported provenance label (LT8)", async () => {
    stub();
    renderWithProviders(<LiteLLMUsersList />);
    await screen.findByText("Ada Lovelace");
    expect(screen.getByText(/litellm-reported/i)).toBeInTheDocument();
  });

  it("says LiteLLM is unavailable on a 503 instead of failing the page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = new URL(String(input), "http://localhost").pathname;
        return Promise.resolve(
          path === "/api/litellm/users"
            ? apiError(503, "LITELLM_UNAVAILABLE")
            : apiResponse({ data: ME }),
        );
      }),
    );
    renderWithProviders(<LiteLLMUsersList />);
    expect(await screen.findByText("LiteLLM unavailable")).toBeInTheDocument();
  });
});

describe("LiteLLMUsersList link controls (D16)", () => {
  it("mayLink true shows Unlink and the none-state actions", async () => {
    stub({ mayLink: true });
    renderWithProviders(<LiteLLMUsersList />);
    await screen.findByText("Ada Lovelace");
    expect(
      await screen.findByRole("button", { name: /unlink/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Link to an existing LiteLLM user" }),
    ).toBeInTheDocument();
  });

  it("shows controls from mayLink alone, whatever /api/me roles say (F1)", async () => {
    stub({ mayLink: true, me: { roles: ["internal-viewer"] } });
    renderWithProviders(<LiteLLMUsersList />);
    await screen.findByText("Ada Lovelace");
    expect(
      await screen.findByRole("button", { name: /unlink/i }),
    ).toBeInTheDocument();
  });

  it.each([
    ["mayLink false", false],
    ["mayLink absent (fail closed)", undefined],
  ])("%s: no link control", async (_n, mayLink) => {
    stub({ mayLink, me: { roles: ["internal-admin"] } });
    renderWithProviders(<LiteLLMUsersList />);
    await screen.findByText("Ada Lovelace");
    expect(screen.queryByRole("button", { name: /unlink/i })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /link to an existing/i }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /^create litellm user$/i }),
    ).toBeNull();
  });

  it("shows no control on the caller's own row, even for an admin (D16)", async () => {
    stub({ users: [ROW_OWN], mayLink: true });
    renderWithProviders(<LiteLLMUsersList />);
    await screen.findByText("Me Myself");
    expect(screen.queryAllByRole("button", { name: /link/i })).toEqual([]);
  });

  it("shows no control while the caller's oid is unknown, even with mayLink true (fail closed)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = new URL(String(input), "http://localhost").pathname;
        if (path === "/api/me") return Promise.resolve(apiError(500));
        return Promise.resolve(
          apiResponse({
            data: {
              users: [ROW_NONE],
              page: 1,
              pageSize: 25,
              hasMore: false,
              enabledOperations: ["createUser"],
              mayLink: true,
            },
          }),
        );
      }),
    );
    renderWithProviders(<LiteLLMUsersList />);
    await screen.findByText("Bob Barker");
    expect(screen.queryByRole("button", { name: /link/i })).toBeNull();
  });

  it("offers Create LiteLLM user (was Create and link; T-UP1) when the list's enabledOperations has createUser (OSS)", async () => {
    stub({ users: [ROW_NONE], enabledOperations: ["createUser"] });
    renderWithProviders(<LiteLLMUsersList />);
    expect(
      await screen.findByRole("button", { name: "Create LiteLLM user" }),
    ).toBeInTheDocument();
  });

  it("on Enterprise (no createUser) offers no Create LiteLLM user and says to sign in once", async () => {
    stub({ users: [ROW_NONE], enabledOperations: [] });
    renderWithProviders(<LiteLLMUsersList />);
    expect(
      await screen.findByText("Sign in to LiteLLM once, then retry."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Create LiteLLM user" }),
    ).toBeNull();
  });
});

// RS1 (Design System - "Reset spend from the LiteLLM users tab and the Users
// page", D1-D5; LiteLLM spec `resetMemberSpend` row): a row action "Reset
// spend" opens ResetMemberSpendDialog (its own test covers the dialog). Shown
// only when the list response's enabledOperations has resetMemberSpend (D4),
// the row has an app identity (`appUser.oid`) and a LiteLLM user, and the
// caller may write: the list response's `mayLink` is the server-computed
// "admin or org-admin" flag (the only readers of this list who may reset; an
// Auditor reads it, a Lead and a Viewer get the 404 and never see the tab), so
// `mayLink` absent or false hides the action (fail closed). Accessible name
// `Reset spend for ${name}` where name = displayName, else email.
describe("Reset spend row action (RS1)", () => {
  const ON = ["createUser", "resetMemberSpend", "resetUserSpend"];
  const ROW_LITELLM_ONLY = {
    key: "ll-zed",
    linkState: "none",
    appUser: null,
    litellmUser: {
      userId: "ll-zed",
      email: "zed@example.com",
      spend: 1,
      maxBudget: null,
      teams: [],
    },
  };
  const ROW_MATCH = {
    ...ROW_NONE,
    linkState: "match",
    litellmUser: { ...ROW_LINKED.litellmUser, userId: "ll-bob" },
  };

  it("shows on a row with an app identity and a LiteLLM user when resetMemberSpend is enabled and the caller may write (D4)", async () => {
    stub({ enabledOperations: ON, mayLink: true });
    renderWithProviders(<LiteLLMUsersList />);
    expect(
      await screen.findByRole("button", {
        name: "Reset spend for Ada Lovelace",
      }),
    ).toBeInTheDocument();
  });

  // R1 (coordinator ruling, review r1; Q-W2) supersedes RS2's "absent when
  // resetUserSpend is off": the row button shows when either operation is on,
  // and inside the dialog each control shows exactly when its own operation is
  // on (D-RS2, Design System "absent, never dead").
  it.each([
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ] as const)(
    "resetMemberSpend=%s resetUserSpend=%s: the row button and each dialog control follow their own operation (R1)",
    async (memberOn, userOn) => {
      stub({
        enabledOperations: [
          "createUser",
          ...(memberOn ? ["resetMemberSpend"] : []),
          ...(userOn ? ["resetUserSpend"] : []),
        ],
        mayLink: true,
        memberships: [
          { teamId: "t1", teamName: "Payments", spend: 6, maxBudget: 10 },
        ],
      });
      const user = userEvent.setup();
      renderWithProviders(<LiteLLMUsersList />);
      await screen.findByText("Ada Lovelace");
      const trigger = screen.queryByRole("button", {
        name: "Reset spend for Ada Lovelace",
      });
      if (!memberOn && !userOn) {
        expect(trigger).toBeNull();
        return;
      }
      expect(trigger).not.toBeNull();
      if (!trigger) return;
      await user.click(trigger);
      const dialog = await screen.findByRole("alertdialog");
      if (memberOn) {
        await within(dialog).findByRole("button", {
          name: "Reset spend in Payments",
        });
      } else {
        await within(dialog).findByRole("group", {
          name: "User spend (all of LiteLLM)",
        });
      }
      expect(
        within(dialog).queryByRole("group", {
          name: "User spend (all of LiteLLM)",
        }) !== null,
      ).toBe(userOn);
      expect(
        within(dialog).queryByRole("button", {
          name: "Reset spend in Payments",
        }) !== null,
      ).toBe(memberOn);
      expect(
        within(dialog).queryByRole("button", { name: "Reset all listed" }) !==
          null,
      ).toBe(memberOn);
    },
  );

  it.each([
    ["an Auditor (mayLink false)", false],
    ["a response without the flag (fail closed)", undefined],
  ])(
    "is absent for %s whatever the toggle says (Roles and rights)",
    async (_n, mayLink) => {
      stub({ enabledOperations: ON, mayLink });
      renderWithProviders(<LiteLLMUsersList />);
      await screen.findByText("Ada Lovelace");
      expect(screen.queryByRole("button", { name: /reset spend/i })).toBeNull();
    },
  );

  // RS2 supersedes RS1's "linked rows only" (D-RS7, Design System - "Reset any
  // LiteLLM user"): every row with a LiteLLM user has the action, linked to an
  // app user or not; a person not in LiteLLM has nothing to reset.
  it("shows on a LiteLLM-only row (no app identity), named by its email (RS2, item 18)", async () => {
    stub({
      users: [ROW_LITELLM_ONLY, ROW_NONE],
      enabledOperations: ON,
      mayLink: true,
    });
    renderWithProviders(<LiteLLMUsersList />);
    await screen.findByText("Bob Barker");
    expect(
      screen.getByRole("button", { name: "Reset spend for zed@example.com" }),
    ).toBeInTheDocument();
  });

  it("is absent on a person not in LiteLLM: there is no LiteLLM user to reset (RS2)", async () => {
    stub({ users: [ROW_NONE], enabledOperations: ON, mayLink: true });
    renderWithProviders(<LiteLLMUsersList />);
    await screen.findByText("Bob Barker");
    expect(screen.queryByRole("button", { name: /reset spend/i })).toBeNull();
  });

  it("an unlinked row's dialog offers 'User spend (all of LiteLLM)' and resets by LiteLLM id (D-RS4, D-RS7)", async () => {
    stub({ users: [ROW_LITELLM_ONLY], enabledOperations: ON, mayLink: true });
    const user = userEvent.setup();
    renderWithProviders(<LiteLLMUsersList />);
    await user.click(
      await screen.findByRole("button", {
        name: "Reset spend for zed@example.com",
      }),
    );
    const option = await screen.findByRole("group", {
      name: "User spend (all of LiteLLM)",
    });
    const fetched = vi.mocked(fetch).mock.calls.map(([u]) => String(u));
    expect(fetched).toContain("/api/litellm/users/ll-zed/memberships");
    expect(
      within(option).getByRole("button", {
        name: "Reset user spend in all of LiteLLM",
      }),
    ).toBeInTheDocument();
  });

  it("shows on a 'Match found' row too: it has an oid and a LiteLLM user (D4)", async () => {
    stub({ users: [ROW_MATCH], enabledOperations: ON, mayLink: true });
    renderWithProviders(<LiteLLMUsersList />);
    expect(
      await screen.findByRole("button", { name: "Reset spend for Bob Barker" }),
    ).toBeInTheDocument();
  });

  it("opens the dialog for that person and reads that LiteLLM user's memberships (D2)", async () => {
    stub({ enabledOperations: ON, mayLink: true });
    const user = userEvent.setup();
    renderWithProviders(<LiteLLMUsersList />);
    await user.click(
      await screen.findByRole("button", {
        name: "Reset spend for Ada Lovelace",
      }),
    );
    expect(
      await screen.findByRole("alertdialog", {
        name: "Reset spend for Ada Lovelace?",
      }),
    ).toBeInTheDocument();
    const fetched = vi.mocked(fetch).mock.calls.map(([u]) => String(u));
    expect(fetched).toContain("/api/litellm/users/ll-ada/memberships");
  });

  it("is also on the stacked card layout below md (touch)", async () => {
    mobile.on = true;
    try {
      stub({ enabledOperations: ON, mayLink: true });
      renderWithProviders(<LiteLLMUsersList />);
      const list = await screen.findByRole("list", { name: "LiteLLM users" });
      expect(
        within(list).getByRole("button", {
          name: "Reset spend for Ada Lovelace",
        }),
      ).toBeInTheDocument();
    } finally {
      mobile.on = false;
    }
  });
});

// Design System - Management pages, LiteLLM users tab, D-LF1 and T-LF2: the
// tab's search has its own response shape (LiteLLMUserSearchResponseSchema)
// and the client parses it with that schema. A search row has no key,
// linkState, appUser or litellmUser, and the page has no hasMore. RS2: Reset
// spend stays on every row with a LiteLLM user, and LD23: no cost figure under
// the Organisation cap.
describe("LiteLLMUsersList search (D-LF1, T-LF2)", () => {
  const search = async (text = "ad") => {
    const user = userEvent.setup();
    renderWithProviders(<LiteLLMUsersList />);
    await screen.findByText("Ada Lovelace");
    await user.type(
      screen.getByRole("searchbox", { name: /search users/i }),
      text,
    );
  };

  it("renders the rows of a search response with no error (the route answers the search shape for ?q=)", async () => {
    const calls = stub();
    await search();
    const row = (
      await screen.findByRole(
        "link",
        { name: "ada@example.com" },
        { timeout: 3000 },
      )
    ).closest("tr");
    expect(row).not.toBeNull();
    expect(row).toHaveTextContent("$12.50");
    expect(row).toHaveTextContent("Payments");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(calls.listUrls().some((u) => u.searchParams.get("q") === "ad")).toBe(
      true,
    );
  });

  it("keeps Reset spend on a search row for a caller who may write (RS2)", async () => {
    stub({
      enabledOperations: ["createUser", "resetUserSpend"],
      mayLink: true,
    });
    await search();
    expect(
      await screen.findByRole(
        "button",
        { name: "Reset spend for ada@example.com" },
        { timeout: 3000 },
      ),
    ).toBeInTheDocument();
  });

  // Design System users tab LF1 decision (d) and RS2 "Reset any LiteLLM
  // user": a search row has no oid, so the caller's own LiteLLM user is
  // matched by the search response's callerLitellmUserId; list and proxy-team
  // rows already hide Reset on the caller's own row.
  it("hides Reset spend on the caller's own LiteLLM user in search results and keeps it on others (LF1 (d), RS2)", async () => {
    stub({
      enabledOperations: ["createUser", "resetUserSpend"],
      mayLink: true,
      callerLitellmUserId: "ll-me",
      search: [
        { ...SEARCH_ROW, userId: "ll-me", email: "me@example.com" },
        SEARCH_ROW,
      ],
    });
    await search();
    expect(
      await screen.findByRole(
        "button",
        { name: "Reset spend for ada@example.com" },
        { timeout: 3000 },
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "me@example.com" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Reset spend for me@example.com" }),
    ).toBeNull();
  });

  it("shows no Reset spend on a search row when the response says the caller may not write (RS2; fail closed)", async () => {
    stub({
      enabledOperations: ["createUser", "resetUserSpend"],
      mayLink: false,
    });
    await search();
    await screen.findByRole(
      "link",
      { name: "ada@example.com" },
      { timeout: 3000 },
    );
    expect(screen.queryByRole("button", { name: /reset spend/i })).toBeNull();
  });

  it("shows no cost under the Organisation cap: a search row without spend reads no figure and no $0 (LD23)", async () => {
    stub({
      search: [{ userId: "ll-ada", email: "ada@example.com", teams: [] }],
    });
    await search();
    const row = (
      await screen.findByRole(
        "link",
        { name: "ada@example.com" },
        { timeout: 3000 },
      )
    ).closest("tr");
    expect(row).not.toHaveTextContent(/\$/);
  });
});

// Design System - LiteLLM users tab, D-LF4 and T-LF5: the table has no
// linked-account column; each row keeps its buttons (Link or Unlink for the
// roles that may, never on one's own row; RS2's Reset spend on every row
// with a LiteLLM user); the linked account and its state are in the selected
// user's page (T-LP8; the in-place detail is removed, T-LP9).
describe("LiteLLMUsersList without a linked-account column (D-LF4, T-LF5)", () => {
  const ROW_MATCH_SELECTABLE = {
    ...ROW_NONE,
    key: "oid-cy",
    linkState: "match",
    appUser: { ...ROW_NONE.appUser, oid: "oid-cy", displayName: "Cy Young" },
    litellmUser: {
      userId: "ll-cy",
      email: "cy@example.com",
      spend: 1,
      maxBudget: null,
      teams: [],
    },
  };
  const ROW_ONLY = {
    key: "ll-zed",
    linkState: "unlinked",
    appUser: null,
    litellmUser: {
      userId: "ll-zed",
      email: "zed@example.com",
      spend: 1,
      maxBudget: null,
      teams: [],
    },
  };
  const ON = ["createUser", "resetMemberSpend", "resetUserSpend"];
  const STATES = ["Linked", "Match found", "No LiteLLM user with that email"];

  it("has no Link column and no link-state text in any row, and keeps Unlink, Link and Reset spend", async () => {
    stub({ users: [ROW_LINKED, ROW_NONE], enabledOperations: ON });
    renderWithProviders(<LiteLLMUsersList />);
    await screen.findByText("Ada Lovelace");
    const table = screen.getByRole("table");
    for (const header of within(table).getAllByRole("columnheader")) {
      expect(header).not.toHaveTextContent(/link/i);
    }
    for (const text of STATES) {
      expect(within(table).queryByText(text)).toBeNull();
    }
    expect(
      within(table).getByRole("button", { name: /unlink/i }),
    ).toBeInTheDocument();
    expect(
      within(table).getByRole("button", {
        name: "Link to an existing LiteLLM user",
      }),
    ).toBeInTheDocument();
    expect(
      within(table).getByRole("button", {
        name: "Reset spend for Ada Lovelace",
      }),
    ).toBeInTheDocument();
  });

  it("an auditor's rows (no write) carry no link-state text and no button at all", async () => {
    stub({
      users: [ROW_LINKED, ROW_NONE],
      enabledOperations: ON,
      mayLink: false,
    });
    renderWithProviders(<LiteLLMUsersList />);
    await screen.findByText("Ada Lovelace");
    const table = screen.getByRole("table");
    expect(
      within(table).queryAllByRole("button", { name: /link|reset/i }),
    ).toEqual([]);
    for (const text of STATES) {
      expect(within(table).queryByText(text)).toBeNull();
    }
  });

  it("the stacked card layout below md has no link-state text either", async () => {
    mobile.on = true;
    try {
      stub({ users: [ROW_LINKED, ROW_NONE], enabledOperations: ON });
      renderWithProviders(<LiteLLMUsersList />);
      const list = await screen.findByRole("list", { name: "LiteLLM users" });
      for (const text of STATES) {
        expect(within(list).queryByText(text)).toBeNull();
      }
      expect(
        within(list).getByRole("button", {
          name: "Reset spend for Ada Lovelace",
        }),
      ).toBeInTheDocument();
    } finally {
      mobile.on = false;
    }
  });

  // T-LP9 (Design System - LiteLLM users tab, round 3): the in-place detail
  // is removed, so a click opens the page and nothing renders under the table;
  // the linked account and its state are on the page (T-LP8).
  it.each([
    ["linked", ROW_LINKED, "Ada Lovelace"],
    ["a match", ROW_MATCH_SELECTABLE, "Cy Young"],
    ["a LiteLLM user with no app user", ROW_ONLY, "zed@example.com"],
  ] as const)(
    "T-LP9: a click on %s leaves nothing under the table: no link state, no detail, no detail request",
    async (_name, row, label) => {
      const calls = stub({ users: [row] });
      const user = userEvent.setup();
      const stopNavigation = (event: Event) => event.preventDefault();
      document.addEventListener("click", stopNavigation);
      try {
        renderWithProviders(<LiteLLMUsersList />);
        const table = await screen.findByRole("table");
        await user.click(within(table).getByRole("link", { name: label }));
        for (const text of STATES) {
          expect(screen.queryByText(text)).toBeNull();
        }
        expect(
          screen.queryByRole("heading", { name: "User usage" }),
        ).toBeNull();
        expect(
          screen.queryByRole("region", { name: /user usage/i }),
        ).toBeNull();
        expect(
          calls.urls.some((u) =>
            /^\/api\/litellm\/users\/[^/]+$/.test(u.pathname),
          ),
        ).toBe(false);
      } finally {
        document.removeEventListener("click", stopNavigation);
      }
    },
  );
});

// Design System - LiteLLM users tab, D-LF3: "Members of one team" lists the
// teams that exist in LiteLLM (listTeams, linked or not); an app team with no
// LiteLLM team is absent. A linked team lists through its app team (the stored
// link); a LiteLLM team with no app team lists its members through RS2's
// GET /api/litellm/proxy-teams/[litellmTeamId]/members.
describe("LiteLLMUsersList team picker (D-LF3, T-LF4)", () => {
  const openPicker = async () => {
    const user = userEvent.setup();
    renderWithProviders(<LiteLLMUsersList />);
    await screen.findByText("Ada Lovelace");
    await user.click(
      screen.getByRole("radio", { name: "Members of one team" }),
    );
    return { user, picker: await screen.findByLabelText("Team") };
  };

  it("lists only LiteLLM teams, linked or not; an app team with no LiteLLM team is absent", async () => {
    stub();
    const { picker } = await openPicker();
    const labels = within(picker)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(labels).toEqual(["Choose a team", "Alpha", "Shared platform"]);
    expect(within(picker).queryByRole("option", { name: "Team U" })).toBeNull();
  });

  it("a LiteLLM team with no app team lists its members through the proxy-team read, never through ?team=", async () => {
    const calls = stub({
      proxyMembers: [
        {
          userId: "ll-zed",
          email: "zed@example.com",
          spend: 4,
          maxBudget: null,
          person: null,
        },
      ],
    });
    const { user, picker } = await openPicker();
    await user.selectOptions(picker, "Shared platform");
    expect(await screen.findByText("zed@example.com")).toBeInTheDocument();
    expect(
      calls.urls.some(
        (u) => u.pathname === "/api/litellm/proxy-teams/ll-team-shared/members",
      ),
    ).toBe(true);
    expect(calls.listUrls().some((u) => u.searchParams.has("team"))).toBe(
      false,
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

// Design System - LiteLLM users tab, LF1 F1 (agent decision 2026-11-24):
// *Reset any LiteLLM user* (RS2) puts Reset spend on every row of the table,
// including the members of a LiteLLM team with no app team. The members read
// carries no write flag, so the page passes the server capability as the prop
// `canReset` (as the LiteLLM teams table gets `canEdit`): true for admin and
// org-admin, false for the auditor. Link and Unlink stay absent there (no app
// identity on those rows); never on the caller's own row (Access Control -
// LiteLLM user links); absent when neither reset operation is on (R1).
describe("LiteLLMUsersList Reset spend in a LiteLLM team with no app team (LF1 F1, RS2)", () => {
  const MEMBERS = [
    {
      userId: "ll-zed",
      email: "zed@example.com",
      spend: 4,
      maxBudget: null,
      person: null,
    },
    {
      userId: "ll-me",
      email: "me@example.com",
      spend: 1,
      maxBudget: null,
      person: { oid: "oid-me", name: "Me Myself" },
    },
  ];

  const openShared = async (
    props: { canReset?: boolean },
    proxyOps?: string[],
  ) => {
    stub({ proxyMembers: MEMBERS, ...(proxyOps ? { proxyOps } : {}) });
    const user = userEvent.setup();
    renderWithProviders(<LiteLLMUsersList {...props} />);
    await screen.findByText("Ada Lovelace");
    await user.click(
      screen.getByRole("radio", { name: "Members of one team" }),
    );
    await user.selectOptions(
      await screen.findByLabelText("Team"),
      "Shared platform",
    );
    await screen.findByText("zed@example.com");
  };

  it.each([
    ["resetMemberSpend", ["getTeam", "resetMemberSpend"]],
    ["resetUserSpend", ["getTeam", "resetUserSpend"]],
    ["both", ["getTeam", "resetMemberSpend", "resetUserSpend"]],
  ])(
    "canReset with %s on: Reset spend on each member row, none on the caller's own row, no Link or Unlink (RS2, R1)",
    async (_n, ops) => {
      await openShared({ canReset: true }, ops);
      expect(
        screen.getByRole("button", { name: "Reset spend for zed@example.com" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /reset spend for me@example/i }),
      ).toBeNull();
      expect(screen.queryByRole("button", { name: /link/i })).toBeNull();
    },
  );

  it("canReset with both reset operations off: no Reset spend (absent, never dead; R1)", async () => {
    await openShared({ canReset: true }, ["getTeam"]);
    expect(screen.queryByRole("button", { name: /reset spend/i })).toBeNull();
  });

  it.each([
    ["canReset false (auditor)", { canReset: false }],
    ["canReset absent (fail closed)", {}],
  ])("%s: no Reset spend on any member row (RS2)", async (_n, props) => {
    await openShared(props);
    expect(screen.queryByRole("button", { name: /reset spend/i })).toBeNull();
  });

  it("the stacked card layout below md has Reset spend too (RS2)", async () => {
    mobile.on = true;
    try {
      await openShared({ canReset: true });
      const list = screen.getByRole("list", { name: "LiteLLM users" });
      expect(
        within(list).getByRole("button", {
          name: "Reset spend for zed@example.com",
        }),
      ).toBeInTheDocument();
    } finally {
      mobile.on = false;
    }
  });
});

// Design System - LiteLLM users tab, LF1 F2 (agent decision 2026-11-24, the
// users-tab wording): an empty value reads "\u2014" in the list rows, the
// and the cards (D-LF1 uses the same dash for absent spend); never "-". The
// detail moved to the user page (T-LP8, ProxyUserSummaryPanel.test.tsx).
describe("LiteLLMUsersList empty value is an em dash (LF1 F2, D-LF1)", () => {
  const ROW_BARE = {
    key: "ll-zed",
    linkState: "unlinked",
    appUser: null,
    litellmUser: {
      userId: "ll-zed",
      email: "zed@example.com",
      spend: 1,
      maxBudget: null,
      teams: [],
    },
  };
  const cellTexts = (root: HTMLElement) =>
    within(root)
      .getAllByRole("cell")
      .map((c) => c.textContent?.trim());

  it("a row with no teams and an email equal to its name shows \u2014 in those cells, never a hyphen", async () => {
    stub({ users: [ROW_BARE] });
    renderWithProviders(<LiteLLMUsersList />);
    const row = (await screen.findByText("zed@example.com")).closest("tr");
    expect(row).not.toBeNull();
    const texts = cellTexts(row as HTMLElement);
    expect(texts).not.toContain("-");
    expect(texts.filter((t) => t === "\u2014")).toHaveLength(2);
  });

  it("the stacked card shows \u2014 for no teams and the same email, never a hyphen", async () => {
    mobile.on = true;
    try {
      stub({ users: [ROW_BARE] });
      renderWithProviders(<LiteLLMUsersList />);
      const list = await screen.findByRole("list", { name: "LiteLLM users" });
      const dds = within(list)
        .getAllByText(/./, { selector: "dd" })
        .map((d) => d.textContent?.trim());
      expect(dds).not.toContain("-");
      expect(dds.filter((t) => t === "\u2014")).toHaveLength(2);
    } finally {
      mobile.on = false;
    }
  });
});

// Source: Design System - "Sorting in the other tables (unit SRT1, 2026-11-24;
// user item 10; D-SR1, D-SR2)": a table sorts with the one `SortableHeader`
// (`sortKeys` per table); the LiteLLM users tab sorts on the server by email
// and spend, "spend is not offered when per-user cost is hidden or capped,
// LD23; with no sort the page keeps LiteLLM's own order"; the sort lives in
// the URL (nuqs `sort`, `dir`). The route side is tested in
// app/api/litellm/users/route.integration.test.ts.
describe("LiteLLMUsersList sorting (unit SRT1, D-SR1)", () => {
  const header = (name: string) => screen.getByRole("columnheader", { name });
  const first = (calls: ReturnType<typeof stub>) =>
    calls.listUrls()[0]!.searchParams;

  it("Email and Spend are sortable headers; the others are not", async () => {
    stub();
    renderWithProviders(<LiteLLMUsersList />);
    await screen.findByText("Ada Lovelace");
    expect(
      within(header("Email")).getByRole("button", { name: "Email" }),
    ).toBeInTheDocument();
    expect(
      within(header("Spend")).getByRole("button", { name: "Spend" }),
    ).toBeInTheDocument();
    for (const name of ["User", "Budget", "Teams", "Actions"]) {
      expect(within(header(name)).queryByRole("button")).toBeNull();
    }
  });

  it("with no sort in the URL no header is active and the request carries no sort (LiteLLM's own order)", async () => {
    const calls = stub();
    renderWithProviders(<LiteLLMUsersList />);
    await screen.findByText("Ada Lovelace");
    expect(header("Email")).toHaveAttribute("aria-sort", "none");
    expect(header("Spend")).toHaveAttribute("aria-sort", "none");
    expect(first(calls).has("sort")).toBe(false);
    expect(first(calls).has("dir")).toBe(false);
  });

  it.each([
    ["email", "asc", "Email", "ascending"],
    ["email", "desc", "Email", "descending"],
    ["spend", "desc", "Spend", "descending"],
  ] as const)(
    "?sort=%s&dir=%s: the %s header says %s and the request carries sort and dir",
    async (sort, dir, name, aria) => {
      const calls = stub();
      renderWithProviders(<LiteLLMUsersList />, {
        searchParams: { sort, dir },
      });
      await screen.findByText("Ada Lovelace");
      expect(header(name)).toHaveAttribute("aria-sort", aria);
      const other = name === "Email" ? "Spend" : "Email";
      expect(header(other)).toHaveAttribute("aria-sort", "none");
      expect(first(calls).get("sort")).toBe(sort);
      expect(first(calls).get("dir")).toBe(dir);
    },
  );

  it("an unknown ?sort= is ignored: no active header and no sort in the request (never a client string to the API)", async () => {
    const calls = stub();
    renderWithProviders(<LiteLLMUsersList />, {
      searchParams: { sort: "created", dir: "desc" },
    });
    await screen.findByText("Ada Lovelace");
    expect(header("Email")).toHaveAttribute("aria-sort", "none");
    expect(first(calls).has("sort")).toBe(false);
  });

  it("clicking Spend writes sort=spend, dir=asc to the URL and refetches sorted", async () => {
    const onUrlUpdate = vi.fn();
    const calls = stub();
    renderWithProviders(<LiteLLMUsersList />, { onUrlUpdate });
    await screen.findByText("Ada Lovelace");
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Spend" }));
    await vi.waitFor(() =>
      expect(
        calls
          .listUrls()
          .some(
            (u) =>
              u.searchParams.get("sort") === "spend" &&
              u.searchParams.get("dir") === "asc",
          ),
      ).toBe(true),
    );
    const last = onUrlUpdate.mock.calls.at(-1)?.[0]?.queryString as string;
    expect(last).toContain("sort=spend");
    expect(last).toContain("dir=asc");
  });

  it("per-user cost hidden (the Organisation cap): the Spend header offers no sort, Email still does, and the request carries no sort=spend (LD23)", async () => {
    const capped = {
      userId: "ll-ada",
      email: "ada@example.com",
      teams: [{ teamId: "t1", teamName: "Payments" }],
    };
    const calls = stub({ users: [{ ...ROW_LINKED, litellmUser: capped }] });
    renderWithProviders(<LiteLLMUsersList />);
    await screen.findByText("Ada Lovelace");
    expect(screen.queryByRole("button", { name: "Spend" })).toBeNull();
    expect(
      within(header("Email")).getByRole("button", { name: "Email" }),
    ).toBeInTheDocument();
    expect(
      calls.listUrls().every((u) => u.searchParams.get("sort") !== "spend"),
    ).toBe(true);
  });

  it("a 400 for sort=spend removes sort and dir from the URL and the next request carries no sort (spend not offered when cost is hidden)", async () => {
    const onUrlUpdate = vi.fn();
    const calls = stub();
    const inner = globalThis.fetch;
    const rejected: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), "http://localhost");
        if (
          url.pathname === "/api/litellm/users" &&
          url.searchParams.get("sort") === "spend"
        ) {
          rejected.push(url.search);
          return Promise.resolve(apiError(400, "BAD_REQUEST"));
        }
        return inner(input, init);
      }),
    );
    renderWithProviders(<LiteLLMUsersList />, {
      searchParams: { sort: "spend", dir: "desc" },
      onUrlUpdate,
    });
    await vi.waitFor(() => expect(rejected.length).toBeGreaterThan(0));
    await vi.waitFor(() => {
      const update = onUrlUpdate.mock.calls.at(-1)?.[0]?.queryString as
        | string
        | undefined;
      expect(update ?? "sort=spend").not.toContain("sort=");
      expect(update ?? "dir=").not.toContain("dir=");
    });
    await screen.findByText("Ada Lovelace");
    const lastList = calls.listUrls().at(-1)!;
    expect(lastList.searchParams.has("sort")).toBe(false);
    expect(lastList.searchParams.has("dir")).toBe(false);
  });
});

// Design System - LiteLLM client requests (unit FX1; D-R3-16), T-FX3: the team
// picker reads GET /api/litellm/org, which requires a date range, so the
// request carries the URL range and the picker lists the teams.
describe("LiteLLMUsersList team picker request (T-FX3)", () => {
  const RANGE = { dateFrom: "2026-10-01", dateTo: "2026-10-31" };

  it("T-FX3: GET /api/litellm/org has dateFrom and dateTo from the URL, and the picker lists the teams", async () => {
    const urls: URL[] = [];
    stub();
    const base = globalThis.fetch;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      urls.push(url);
      if (
        url.pathname === "/api/litellm/org" &&
        !(url.searchParams.has("dateFrom") && url.searchParams.has("dateTo"))
      ) {
        return Promise.resolve(
          apiError(400, "BAD_REQUEST", "dateFrom and dateTo are required"),
        );
      }
      return base(input, init);
    });
    const user = userEvent.setup();
    renderWithProviders(<LiteLLMUsersList />, { searchParams: RANGE });
    await screen.findByText("Ada Lovelace");
    await user.click(
      screen.getByRole("radio", { name: "Members of one team" }),
    );

    const picker = await screen.findByLabelText("Team");
    expect(
      within(picker)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(expect.arrayContaining(["Alpha", "Shared platform"]));
    expect(screen.queryByRole("alert")).toBeNull();
    const org = urls.find((u) => u.pathname === "/api/litellm/org");
    expect(org?.searchParams.get("dateFrom")).toBe(RANGE.dateFrom);
    expect(org?.searchParams.get("dateTo")).toBe(RANGE.dateTo);
  });
});

// Sources: Design System - LiteLLM users tab, round 3 (unit LP2, user,
// 2026-11-25; D-R3-8, D-R3-9; unit UP1 D-R3-10, D-R3-11), T-LP6: "Search users"
// is a `SearchInput` (visible label, the magnifier); a term of one character
// shows "Type at least 2 characters"; a longer term narrows the list; a term
// that matches nothing shows "No users found"; T-LP9: "The user cell of each
// row links to /dashboard/manage/litellm/users/[litellmUserId] ... the detail
// that opened under the table is removed"; "Create and link" is renamed
// "Create LiteLLM user", and the "Match found" badge is removed. LiteLLM spec -
// searchUsers takes 2-100 characters (allowlist); Rule 60.24a.
describe("LiteLLMUsersList search box (T-LP6)", () => {
  const box = () => screen.getByRole("searchbox", { name: "Search users" });

  it("T-LP6: 'Search users' has a visible label and the magnifier (the SearchInput)", async () => {
    stub();
    renderWithProviders(<LiteLLMUsersList />);
    await screen.findByText("Ada Lovelace");
    expect(screen.getByText("Search users").tagName).toBe("LABEL");
    expect(screen.getByLabelText("Search users")).toBe(box());
    expect(
      box().parentElement?.querySelector("svg[aria-hidden='true']"),
    ).not.toBeNull();
  });

  it("T-LP6: one character shows 'Type at least 2 characters' and sends no search", async () => {
    // Only timers are faked (Rule 60.24); fetch and promises stay real.
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout"],
      shouldAdvanceTime: true,
    });
    try {
      const calls = stub();
      renderWithProviders(<LiteLLMUsersList />);
      await screen.findByText("Ada Lovelace");
      const user = userEvent.setup({
        advanceTimers: (ms) => vi.advanceTimersByTime(ms),
        delay: null,
      });
      await user.type(box(), "a");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(
        await screen.findByText("Type at least 2 characters"),
      ).toBeInTheDocument();
      expect(calls.listUrls().some((u) => u.searchParams.has("q"))).toBe(false);
      expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("T-LP6: the hint goes away at two characters and the search narrows the list", async () => {
    const calls = stub({ search: [SEARCH_ROW] });
    renderWithProviders(<LiteLLMUsersList />);
    await screen.findByText("Bob Barker");
    const user = userEvent.setup();
    await user.type(box(), "a");
    await screen.findByText("Type at least 2 characters");
    await user.type(box(), "d");
    await vi.waitFor(
      () =>
        expect(
          calls.listUrls().some((u) => u.searchParams.get("q") === "ad"),
        ).toBe(true),
      { timeout: 3000 },
    );
    expect(screen.queryByText("Type at least 2 characters")).toBeNull();
    // Design System - T-LP6 (a longer term narrows the list). The all-users rows
    // leave as soon as SearchView mounts its skeleton, before the search answer
    // renders, so wait for the answer's link, then assert the list narrowed.
    expect(
      await screen.findByRole(
        "link",
        { name: "ada@example.com" },
        { timeout: 3000 },
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Bob Barker")).toBeNull();
  });

  it("T-LP6: a term that matches nothing shows 'No users found'", async () => {
    stub({ search: [] });
    renderWithProviders(<LiteLLMUsersList />);
    await screen.findByText("Ada Lovelace");
    await userEvent.setup().type(box(), "zz");
    expect(
      await screen.findByText("No users found", {}, { timeout: 3000 }),
    ).toBeInTheDocument();
  });
});

// Sources: Design System - LiteLLM users tab, round 3 (unit LP2), T-LP6 (the
// search the tab took over from the removed UserSearch component); LiteLLM
// spec - allowlist row `searchUsers` (2-100 characters), LT8 (LiteLLM-reported
// spend and budget; a null budget is "No limit", never $0). The tab debounces
// the box (DEBOUNCE_MS, 500 ms), so the case below keeps that delay.
describe("LiteLLMUsersList search request rules (T-LP6, searchUsers 2-100)", () => {
  const box = () => screen.getByRole("searchbox", { name: "Search users" });
  const qs = (calls: { listUrls: () => URL[] }) =>
    calls.listUrls().flatMap((u) => u.searchParams.get("q") ?? []);

  it("T-LP6: typing 'ada' key by key sends one search with the final value (debounce)", async () => {
    // Only timers are faked (Rule 60.24); fetch and promises stay real.
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout"],
      shouldAdvanceTime: true,
    });
    try {
      const calls = stub();
      renderWithProviders(<LiteLLMUsersList />);
      await screen.findByText("Ada Lovelace");
      const user = userEvent.setup({
        advanceTimers: (ms) => vi.advanceTimersByTime(ms),
        delay: null,
      });
      await user.type(box(), "ada");
      expect(qs(calls)).toEqual([]);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      await vi.waitFor(() => expect(qs(calls)).toEqual(["ada"]));
    } finally {
      vi.useRealTimers();
    }
  });

  it("T-LP6: a term of spaces only is not a query (trimmed)", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout"],
      shouldAdvanceTime: true,
    });
    try {
      const calls = stub();
      renderWithProviders(<LiteLLMUsersList />);
      await screen.findByText("Ada Lovelace");
      const user = userEvent.setup({
        advanceTimers: (ms) => vi.advanceTimersByTime(ms),
        delay: null,
      });
      await user.type(box(), "  ");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(qs(calls)).toEqual([]);
      expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("LT8: search rows show email, spend and budget in USD, a null budget as No limit, LiteLLM-reported", async () => {
    stub({
      search: [
        SEARCH_ROW,
        {
          userId: "ll-bob",
          email: "bob@example.com",
          spend: 5,
          maxBudget: null,
          teams: [],
        },
      ],
    });
    renderWithProviders(<LiteLLMUsersList />);
    await screen.findByText("Ada Lovelace");
    await userEvent.setup().type(box(), "ex");
    const ada = (
      await screen.findByRole(
        "link",
        { name: "ada@example.com" },
        { timeout: 3000 },
      )
    ).closest("tr");
    expect(ada).not.toBeNull();
    expect(ada).toHaveTextContent("$12.50");
    expect(ada).toHaveTextContent("$100.00");
    const bob = screen.getByRole("link", { name: "bob@example.com" });
    expect(bob.closest("tr")).toHaveTextContent("$5.00");
    expect(bob.closest("tr")).toHaveTextContent(/no limit/i);
    expect(bob.closest("tr")).not.toHaveTextContent("$0");
    expect(screen.getAllByText(/litellm-reported/i).length).toBeGreaterThan(0);
  });

  it("T-LP6: a 503 on the search says LiteLLM unavailable and keeps the box usable", async () => {
    stub();
    const base = vi.mocked(globalThis.fetch);
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
        new URL(String(input), "http://localhost").searchParams.has("q")
          ? Promise.resolve(apiError(503, "LITELLM_UNAVAILABLE"))
          : base(input, init),
      ),
    );
    renderWithProviders(<LiteLLMUsersList />);
    await screen.findByText("Ada Lovelace");
    await userEvent.setup().type(box(), "ad");
    expect(
      await screen.findByText("LiteLLM unavailable", {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(box()).toBeEnabled();
  });
});

describe("LiteLLMUsersList user cell links to the page (T-LP9)", () => {
  const PAGE = "/dashboard/manage/litellm/users";

  it("T-LP9: the user cell of a row with a LiteLLM user is a link to its page by LiteLLM id", async () => {
    stub();
    renderWithProviders(<LiteLLMUsersList />);
    expect(
      await screen.findByRole("link", { name: "Ada Lovelace" }),
    ).toHaveAttribute("href", `${PAGE}/ll-ada`);
  });

  it("T-LP9 / LT3: the LiteLLM id is percent-encoded in the href", async () => {
    stub({
      users: [
        {
          ...ROW_LINKED,
          litellmUser: { ...ROW_LINKED.litellmUser, userId: "ll/odd id" },
        },
      ],
    });
    renderWithProviders(<LiteLLMUsersList />);
    expect(
      await screen.findByRole("link", { name: "Ada Lovelace" }),
    ).toHaveAttribute("href", `${PAGE}/ll%2Fodd%20id`);
  });

  it("T-LP9: a search row links to its page too", async () => {
    stub();
    renderWithProviders(<LiteLLMUsersList />);
    await screen.findByText("Ada Lovelace");
    await userEvent
      .setup()
      .type(screen.getByRole("searchbox", { name: "Search users" }), "ad");
    expect(
      await screen.findByRole(
        "link",
        { name: "ada@example.com" },
        { timeout: 3000 },
      ),
    ).toHaveAttribute("href", `${PAGE}/ll-ada`);
  });

  it("T-LP9: a person not in LiteLLM has no page to open: no link", async () => {
    stub({ users: [ROW_NONE] });
    renderWithProviders(<LiteLLMUsersList />);
    await screen.findByText("Bob Barker");
    expect(screen.queryByRole("link", { name: "Bob Barker" })).toBeNull();
  });

  it("T-LP9: the stacked card layout below md links too", async () => {
    mobile.on = true;
    try {
      stub();
      renderWithProviders(<LiteLLMUsersList />);
      const list = await screen.findByRole("list", { name: "LiteLLM users" });
      expect(
        within(list).getByRole("link", { name: "Ada Lovelace" }),
      ).toHaveAttribute("href", `${PAGE}/ll-ada`);
    } finally {
      mobile.on = false;
    }
  });

  it("UP1 (D-R3-10, D-R3-11): no 'Create and link' and no 'Match found' text anywhere on the tab", async () => {
    stub({ users: [ROW_NONE, ROW_LINKED], enabledOperations: ["createUser"] });
    renderWithProviders(<LiteLLMUsersList />);
    await screen.findByText("Ada Lovelace");
    expect(screen.queryByText(/create and link/i)).toBeNull();
    expect(screen.queryByText(/match found/i)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Create LiteLLM user" }),
    ).toBeInTheDocument();
  });
});
