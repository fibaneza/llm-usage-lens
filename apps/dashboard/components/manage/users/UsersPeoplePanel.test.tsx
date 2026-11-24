import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiResponse } from "@/test/fakes/api-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { UsersPeoplePanel } from "./UsersPeoplePanel";

// Source: Design System - Management improvements, Users (D15: the people
// list with name, email, sign-in method, team and LiteLLM link state from
// GET /api/identities/directory; one Add user action, shown only to a caller
// who may do a step) and User link states (D16: Linked / Match found / No
// LiteLLM user with that email; controls only for admin and org-admin and
// never on the caller's own row; Create and link on OSS only). The directory
// route and the writes are tested in their own files (Rule 60.24a).
const STEPS = {
  admin: { password: true, team: true, link: true },
  orgAdmin: { password: false, team: true, link: true },
  auditor: { password: false, team: false, link: false },
};
const stepUp = {
  entra: vi.fn(),
  credentials: vi.fn(),
  devLogin: vi.fn(),
};

const row = (over: Record<string, unknown>) => ({
  oid: "oid-x",
  displayName: null,
  email: null,
  authMethod: "entra",
  memberTeamId: null,
  litellm: { state: "none" },
  linkVersion: 0,
  ...over,
});
const LINKED = row({
  oid: "oid-ada",
  displayName: "Ada Lovelace",
  email: "ada@example.com",
  memberTeamId: "team-a",
  litellm: { state: "linked", litellmUserId: "ll-ada" },
  linkVersion: 3,
  match: null,
});
const MATCH = row({
  oid: "oid-bob",
  displayName: "Bob Barker",
  email: "bob@example.com",
  authMethod: "password",
  match: { litellmUserId: "ll-bob", email: "bob@example.com" },
});
const NONE = row({
  oid: "oid-cy",
  displayName: "Cy Young",
  email: "cy@example.com",
  match: null,
});
const OWN = row({
  oid: "oid-me",
  displayName: "Me Myself",
  email: "me@example.com",
  match: null,
});

function stub(items: unknown[], cursor?: string) {
  const urls: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      urls.push(url);
      if (url.pathname === "/api/access/org-units") {
        return Promise.resolve(
          apiResponse({
            data: {
              departments: [],
              teams: [{ id: "team-a", name: "Team A", departmentId: "d" }],
            },
          }),
        );
      }
      return Promise.resolve(
        apiResponse({
          data: {
            items: url.searchParams.get("cursor") ? [NONE] : items,
            ...(cursor && !url.searchParams.get("cursor") ? { cursor } : {}),
          },
        }),
      );
    }),
  );
  return urls;
}

function show(
  steps = STEPS.admin,
  over: Partial<{
    canCreate: boolean;
    litellmConfigured: boolean;
    canResetSpend: boolean;
  }> = {},
) {
  renderWithProviders(
    <UsersPeoplePanel
      steps={steps}
      ownOid="oid-me"
      canCreate={over.canCreate ?? true}
      litellmConfigured={over.litellmConfigured ?? true}
      {...(over.canResetSpend === undefined
        ? {}
        : { canResetSpend: over.canResetSpend })}
      authMethod="entra"
      stepUp={stepUp}
    />,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("UsersPeoplePanel people list (D15)", () => {
  it("lists name, email, sign-in method, team name and the link state per person", async () => {
    stub([LINKED, MATCH]);
    show();
    const ada = (await screen.findByText("Ada Lovelace")).closest(
      "tr",
    ) as HTMLElement;
    expect(within(ada).getByText("ada@example.com")).toBeInTheDocument();
    expect(within(ada).getByText("Microsoft Entra")).toBeInTheDocument();
    expect(within(ada).getByText("Team A")).toBeInTheDocument();
    expect(within(ada).getByText("Linked")).toBeInTheDocument();
    const bob = screen.getByText("Bob Barker").closest("tr") as HTMLElement;
    expect(within(bob).getByText("Password")).toBeInTheDocument();
    expect(within(bob).getByText("Match found")).toBeInTheDocument();
  });

  it("a person with no LiteLLM user shows the none state", async () => {
    stub([NONE]);
    show();
    expect(
      await screen.findByText("No LiteLLM user with that email"),
    ).toBeInTheDocument();
  });

  it("asks for the match suggestions and pages with the cursor (Load more)", async () => {
    const urls = stub([LINKED], "next-1");
    show();
    await screen.findByText("Ada Lovelace");
    expect(
      urls
        .find((u) => u.pathname === "/api/identities/directory")
        ?.searchParams.get("include"),
    ).toBe("litellmMatch");
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("Cy Young")).toBeInTheDocument();
    expect(urls.some((u) => u.searchParams.get("cursor") === "next-1")).toBe(
      true,
    );
  });

  it("shows an empty state when nobody has signed in or been added", async () => {
    stub([]);
    show();
    expect(await screen.findByText("No people yet.")).toBeInTheDocument();
  });
});

describe("UsersPeoplePanel Add user and link controls (D15, D16)", () => {
  it.each([
    ["admin", STEPS.admin, true],
    ["org-admin", STEPS.orgAdmin, true],
    ["auditor", STEPS.auditor, false],
  ])("%s: Add user shown = %s", async (_n, steps, shown) => {
    stub([LINKED]);
    show(steps);
    await screen.findByText("Ada Lovelace");
    expect(screen.queryByRole("button", { name: /add user/i }) !== null).toBe(
      shown,
    );
  });

  it("the auditor reads the states and gets no link control", async () => {
    stub([LINKED, MATCH, NONE]);
    show(STEPS.auditor);
    await screen.findByText("Ada Lovelace");
    expect(screen.getByText("Match found")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^(link|unlink|create and link)/i }),
    ).toBeNull();
  });

  it("an org-admin gets the link controls", async () => {
    stub([LINKED]);
    show(STEPS.orgAdmin);
    expect(
      await screen.findByRole("button", { name: /unlink/i }),
    ).toBeInTheDocument();
  });

  it("never offers a control on the caller's own row", async () => {
    stub([OWN]);
    show(STEPS.admin);
    await screen.findByText("Me Myself");
    expect(
      screen.queryByRole("button", { name: /^(link|unlink|create and link)/i }),
    ).toBeNull();
  });

  it("OSS: Create and link on a none row; Enterprise: absent with the sign-in-once note", async () => {
    stub([NONE]);
    show(STEPS.admin, { canCreate: true });
    expect(
      await screen.findByRole("button", { name: "Create and link" }),
    ).toBeInTheDocument();
  });

  it("Enterprise edition: no Create and link, the row says to sign in to LiteLLM once", async () => {
    stub([NONE]);
    show(STEPS.admin, { canCreate: false });
    expect(
      await screen.findByText("Sign in to LiteLLM once, then retry."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Create and link" }),
    ).toBeNull();
  });
});

describe("UsersPeoplePanel without LiteLLM configured (LiteLLM spec LD37)", () => {
  it("an unlinked row says LiteLLM is not configured with no link control, a linked row keeps Linked", async () => {
    stub([LINKED, MATCH, NONE]);
    show(STEPS.admin, { litellmConfigured: false });
    await screen.findByText("Ada Lovelace");
    expect(screen.getAllByText("LiteLLM not configured")).toHaveLength(2);
    expect(screen.getByText("Linked")).toBeInTheDocument();
    expect(screen.queryByText("Match found")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /^(link|create and link)/i }),
    ).toBeNull();
  });
});

// RS1 (Design System - "Reset spend from the LiteLLM users tab and the Users
// page", D2, D4; LiteLLM spec `resetMemberSpend` row): a row action "Reset
// spend" on LINKED people only, opening ResetMemberSpendDialog (its own test
// covers the dialog). Contract: UsersPeoplePanel takes an optional boolean
// `canResetSpend` (default false), resolved by the page on the server (LiteLLM
// configured AND resetMemberSpend enabled AND the caller may write - see
// page.test.tsx); the panel adds the row-level rule (D4): a person with
// `litellm.state === "linked"`. Accessible name `Reset spend for ${name}`
// (displayName, else email, else oid). Nothing is requested until the dialog
// opens. Not configured hides it even when the prop is true (LD37).
describe("UsersPeoplePanel Reset spend row action (RS1)", () => {
  it("shows on a linked person only, not on a match, none or own-unlinked row (D4)", async () => {
    stub([LINKED, MATCH, NONE]);
    show(STEPS.admin, { canResetSpend: true });
    await screen.findByText("Ada Lovelace");
    expect(
      screen.getByRole("button", { name: "Reset spend for Ada Lovelace" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: /reset spend/i }),
    ).toHaveLength(1);
  });

  it.each([
    ["is false (toggle off, no write right)", { canResetSpend: false }],
    ["is not passed (default)", {}],
    [
      "is true but LiteLLM is not configured (LD37)",
      { canResetSpend: true, litellmConfigured: false },
    ],
  ])("is absent when canResetSpend %s", async (_n, over) => {
    stub([LINKED]);
    show(STEPS.admin, over);
    await screen.findByText("Ada Lovelace");
    expect(screen.queryByRole("button", { name: /reset spend/i })).toBeNull();
  });

  it("requests nothing until opened, then reads that person's memberships (D2)", async () => {
    stub([LINKED]);
    show(STEPS.orgAdmin, { canResetSpend: true });
    const trigger = await screen.findByRole("button", {
      name: "Reset spend for Ada Lovelace",
    });
    const memberships = () =>
      vi
        .mocked(fetch)
        .mock.calls.map(([u]) => String(u))
        .filter((u) => u.includes("/memberships"));
    expect(memberships()).toEqual([]);
    await userEvent.setup().click(trigger);
    expect(
      await screen.findByRole("alertdialog", {
        name: "Reset spend for Ada Lovelace?",
      }),
    ).toBeInTheDocument();
    expect(memberships()).toEqual(["/api/litellm/users/ll-ada/memberships"]);
  });
});

// Unit US1 (Design System - "The users table (unit US1, 2026-11-24; D-US1 to
// D-US5, D-US2a, D-US3a)"; Access Control - /api/identities/directory row,
// unit US1; Rule 60.24a: the route's sort and paging are tested in the route's
// own file, here only what the panel renders and requests).
describe("UsersPeoplePanel users table (unit US1)", () => {
  const ADA = row({
    oid: "oid-ada",
    displayName: "Ada Lovelace",
    email: "ada@example.com",
    memberTeamId: "team-a",
    litellm: { state: "linked", litellmUserId: "ll-ada" },
    linkVersion: 3,
    match: null,
    createdAt: "2026-03-05T10:20:30.000Z",
    lastSignInAt: "2026-11-20T23:59:59.000Z",
  });
  // Written before unit US2: no createdAt (D-US2a); no email, no team.
  const OLD = row({
    oid: "oid-old",
    displayName: "Old Timer",
    memberTeamId: null,
    match: null,
    lastSignInAt: "2026-01-02T00:00:00.000Z",
  });
  const SEARCH_HIT = row({
    oid: "oid-hit",
    displayName: "Hit Person",
    email: "hit@example.com",
    match: null,
    createdAt: "2026-02-01T00:00:00.000Z",
    lastSignInAt: "2026-02-02T00:00:00.000Z",
  });

  function stubDirectory(
    pages: { items: unknown[]; cursor?: string; truncated?: boolean },
    hits: unknown[] = [SEARCH_HIT],
  ) {
    const urls: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(String(input), "http://localhost");
        urls.push(url);
        if (url.pathname === "/api/access/org-units") {
          return Promise.resolve(
            apiResponse({
              data: {
                departments: [],
                teams: [{ id: "team-a", name: "Team A", departmentId: "d" }],
              },
            }),
          );
        }
        if (url.searchParams.get("q")) {
          return Promise.resolve(apiResponse({ data: { items: hits } }));
        }
        return Promise.resolve(
          apiResponse({
            data: {
              items: url.searchParams.get("cursor") ? [NONE] : pages.items,
              ...(pages.cursor && !url.searchParams.get("cursor")
                ? { cursor: pages.cursor }
                : {}),
              ...(pages.truncated ? { truncated: true } : {}),
            },
          }),
        );
      }),
    );
    return urls;
  }
  const directoryUrls = (urls: URL[]) =>
    urls.filter((u) => u.pathname === "/api/identities/directory");

  function showAt(
    searchParams: Record<string, string> = {},
    steps = STEPS.admin,
  ) {
    renderWithProviders(
      <UsersPeoplePanel
        steps={steps}
        ownOid="oid-me"
        canCreate
        litellmConfigured
        authMethod="entra"
        stepUp={stepUp}
      />,
      { searchParams },
    );
  }
  const header = (name: string) => screen.getByRole("columnheader", { name });
  const cell = (tr: HTMLElement, column: string) => {
    const index = screen
      .getAllByRole("columnheader")
      .findIndex((th) => th.textContent?.trim().startsWith(column));
    return within(tr).getAllByRole("cell")[index] as HTMLElement;
  };

  it("shows Created and Last sign-in as UTC dates, and an empty value as a dash (D-US2a)", async () => {
    stubDirectory({ items: [ADA, OLD] });
    showAt();
    const ada = (await screen.findByText("Ada Lovelace")).closest(
      "tr",
    ) as HTMLElement;
    expect(cell(ada, "Created")).toHaveTextContent("2026-03-05");
    expect(cell(ada, "Last sign-in")).toHaveTextContent("2026-11-20");
    const old = screen.getByText("Old Timer").closest("tr") as HTMLElement;
    expect(cell(old, "Created")).toHaveTextContent("—");
    expect(cell(old, "Last sign-in")).toHaveTextContent("2026-01-02");
    expect(cell(old, "Email")).toHaveTextContent("—");
    expect(cell(old, "Team")).toHaveTextContent("—");
    expect(screen.queryByText(/unknown/i)).toBeNull();
  });

  it("each row's name links to the user page (D-US5)", async () => {
    stubDirectory({ items: [ADA] });
    showAt();
    const link = await screen.findByRole("link", { name: "Ada Lovelace" });
    expect(link).toHaveAttribute("href", "/dashboard/manage/users/oid-ada");
  });

  it("name, email, created, last sign-in and team are sortable; sign-in method and LiteLLM are not (D-US3a)", async () => {
    stubDirectory({ items: [ADA] });
    showAt();
    await screen.findByText("Ada Lovelace");
    for (const label of ["Name", "Email", "Created", "Last sign-in", "Team"]) {
      expect(
        within(header(label)).getByRole("button", { name: label }),
      ).toBeInTheDocument();
    }
    for (const label of ["Sign-in", "LiteLLM"]) {
      expect(within(header(label)).queryByRole("button")).toBeNull();
    }
  });

  it("opens sorted by name ascending and asks the server for it (D-US3: default name, asc)", async () => {
    const urls = stubDirectory({ items: [ADA] });
    showAt();
    await screen.findByText("Ada Lovelace");
    expect(header("Name")).toHaveAttribute("aria-sort", "ascending");
    expect(header("Email")).toHaveAttribute("aria-sort", "none");
    const first = directoryUrls(urls)[0] as URL;
    expect(first.searchParams.get("sort") ?? "name").toBe("name");
    expect(first.searchParams.get("dir") ?? "asc").toBe("asc");
  });

  it("the sort in the URL is the sort the first request carries", async () => {
    const urls = stubDirectory({ items: [ADA] });
    showAt({ sort: "lastSignInAt", dir: "desc" });
    await screen.findByText("Ada Lovelace");
    expect(header("Last sign-in")).toHaveAttribute("aria-sort", "descending");
    const first = directoryUrls(urls)[0] as URL;
    expect(first.searchParams.get("sort")).toBe("lastSignInAt");
    expect(first.searchParams.get("dir")).toBe("desc");
  });

  it("a sort click requests that sort ascending, a second click descending, and goes back to page 1 (no cursor, earlier pages dropped)", async () => {
    const urls = stubDirectory({ items: [ADA], cursor: "next-1" });
    showAt();
    const user = userEvent.setup();
    await screen.findByText("Ada Lovelace");
    await user.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("Cy Young")).toBeInTheDocument();

    await user.click(within(header("Email")).getByRole("button"));
    await vi.waitFor(() =>
      expect(header("Email")).toHaveAttribute("aria-sort", "ascending"),
    );
    await vi.waitFor(() => {
      const last = directoryUrls(urls).at(-1) as URL;
      expect(last.searchParams.get("sort")).toBe("email");
      expect(last.searchParams.get("dir") ?? "asc").toBe("asc");
      expect(last.searchParams.get("cursor")).toBeNull();
    });
    await vi.waitFor(() =>
      expect(screen.queryByText("Cy Young")).not.toBeInTheDocument(),
    );

    await user.click(within(header("Email")).getByRole("button"));
    await vi.waitFor(() => {
      const last = directoryUrls(urls).at(-1) as URL;
      expect(last.searchParams.get("sort")).toBe("email");
      expect(last.searchParams.get("dir")).toBe("desc");
      expect(last.searchParams.get("cursor")).toBeNull();
    });
  });

  it("Load more keeps the current sort in its request", async () => {
    const urls = stubDirectory({ items: [ADA], cursor: "next-1" });
    showAt({ sort: "team", dir: "desc" });
    await screen.findByText("Ada Lovelace");
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Load more" }));
    await screen.findByText("Cy Young");
    const paged = directoryUrls(urls).find(
      (u) => u.searchParams.get("cursor") === "next-1",
    ) as URL;
    expect(paged.searchParams.get("sort")).toBe("team");
    expect(paged.searchParams.get("dir")).toBe("desc");
  });

  it("says the list is truncated when the server reports it, and not otherwise (the 2,000 bound)", async () => {
    stubDirectory({ items: [ADA], truncated: true });
    showAt();
    await screen.findByText("Ada Lovelace");
    expect(screen.getByText(/truncated/i)).toBeInTheDocument();
  });

  it("shows no truncated notice for a list inside the bound", async () => {
    stubDirectory({ items: [ADA] });
    showAt();
    await screen.findByText("Ada Lovelace");
    expect(screen.queryByText(/truncated/i)).toBeNull();
  });

  describe("search inside the People panel (D-US1)", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    function setup() {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      return userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    }

    it("the People panel holds the one search box, in its header", async () => {
      stubDirectory({ items: [ADA] });
      showAt();
      await screen.findByText("Ada Lovelace");
      const panel = screen.getByRole("region", { name: "People" });
      expect(
        within(panel).getByRole("searchbox", { name: /search/i }),
      ).toBeInTheDocument();
      expect(screen.getAllByRole("searchbox")).toHaveLength(1);
    });

    it("one character requests nothing; two or more search by q, debounced, and show the matches without paging", async () => {
      const urls = stubDirectory({ items: [ADA], cursor: "next-1" });
      const user = setup();
      showAt();
      await screen.findByText("Ada Lovelace");
      const box = screen.getByRole("searchbox", { name: /search/i });

      await user.type(box, "h");
      await vi.advanceTimersByTimeAsync(1500);
      expect(directoryUrls(urls).some((u) => u.searchParams.has("q"))).toBe(
        false,
      );

      await user.type(box, "i");
      await vi.advanceTimersByTimeAsync(1500);
      expect(await screen.findByText("Hit Person")).toBeInTheDocument();
      const search = directoryUrls(urls).find((u) => u.searchParams.has("q"));
      expect(search?.searchParams.get("q")).toBe("hi");
      expect(search?.searchParams.get("cursor")).toBeNull();
      expect(screen.queryByText("Ada Lovelace")).toBeNull();
      expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
    });

    it("clearing the box returns to the sorted list", async () => {
      stubDirectory({ items: [ADA] });
      const user = setup();
      showAt();
      await screen.findByText("Ada Lovelace");
      const box = screen.getByRole("searchbox", { name: /search/i });
      await user.type(box, "hi");
      await vi.advanceTimersByTimeAsync(1500);
      await screen.findByText("Hit Person");
      await user.clear(box);
      await vi.advanceTimersByTimeAsync(1500);
      expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
      expect(screen.queryByText("Hit Person")).toBeNull();
    });
  });

  describe("row actions keep following the role (D-US5a; Design System - row actions unchanged)", () => {
    it.each([
      ["admin", STEPS.admin, true],
      ["org-admin", STEPS.orgAdmin, true],
      ["auditor", STEPS.auditor, false],
    ])(
      "%s: the row actions follow the role, the name link and dates show for all",
      async (_name, steps, actions) => {
        stubDirectory({ items: [ADA] });
        renderWithProviders(
          <UsersPeoplePanel
            steps={steps}
            ownOid="oid-me"
            canCreate
            litellmConfigured
            canResetSpend={actions}
            authMethod="entra"
            stepUp={stepUp}
          />,
        );
        await screen.findByRole("link", { name: "Ada Lovelace" });
        expect(screen.queryByRole("button", { name: /unlink/i }) !== null).toBe(
          actions,
        );
        expect(
          screen.queryByRole("button", { name: /reset spend/i }) !== null,
        ).toBe(actions);
        expect(screen.getByText("2026-03-05")).toBeInTheDocument();
      },
    );
  });
});
