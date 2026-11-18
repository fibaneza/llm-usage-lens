import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiError, apiResponse } from "@/test/fakes/api-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { LiteLLMUsersList } from "./LiteLLMUsersList";

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
};

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
              teams: [{ id: "team-a", name: "Team A", departmentId: "d" }],
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
      return Promise.resolve(apiError(404, "NOT_FOUND"));
    }),
  );
  return {
    listUrls: () => urls.filter((u) => u.pathname === "/api/litellm/users"),
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

  it("Members of one team asks for that team only once one is chosen", async () => {
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
    await user.selectOptions(await screen.findByLabelText("Team"), "team-a");
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
  ])("%s: states shown, no link control", async (_n, mayLink) => {
    stub({ mayLink, me: { roles: ["internal-admin"] } });
    renderWithProviders(<LiteLLMUsersList />);
    await screen.findByText("Ada Lovelace");
    expect(screen.getByText("Linked")).toBeInTheDocument();
    expect(
      screen.getByText("No LiteLLM user with that email"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /unlink/i })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /link to an existing/i }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /create and link/i }),
    ).toBeNull();
  });

  it("shows no control on the caller's own row, even for an admin (D16)", async () => {
    stub({ users: [ROW_OWN], mayLink: true });
    renderWithProviders(<LiteLLMUsersList />);
    await screen.findByText("Me Myself");
    expect(
      screen.getByText("No LiteLLM user with that email"),
    ).toBeInTheDocument();
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

  it("offers Create and link when the list's enabledOperations has createUser (OSS)", async () => {
    stub({ users: [ROW_NONE], enabledOperations: ["createUser"] });
    renderWithProviders(<LiteLLMUsersList />);
    expect(
      await screen.findByRole("button", { name: "Create and link" }),
    ).toBeInTheDocument();
  });

  it("on Enterprise (no createUser) offers no Create and link and says to sign in once", async () => {
    stub({ users: [ROW_NONE], enabledOperations: [] });
    renderWithProviders(<LiteLLMUsersList />);
    expect(
      await screen.findByText("Sign in to LiteLLM once, then retry."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Create and link" }),
    ).toBeNull();
  });
});
