import { act, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fail, ok, page, stubAccessApi } from "@/test/fakes/access-ui-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { IdentityLinksSection } from "./IdentityLinksSection";

// Source: docs/specs/2026-11-10-access-control.md - "Identity links (shared
// contract)": usageIdentities[], aliases[], litellmUserId per oid,
// internal-admin only; "An alias or usage identity belongs to one person
// (duplicate -> 409). Links show a person their own usage and never grant
// access"; "Canonical usage identity" (matching is exact, keys lower-case);
// "API routes (additions)" (/api/identities GET; /api/identities/[oid]/links
// GET (also internal-auditor), PUT internal-admin); "Data model additions"
// (version 0 = no link yet, a PUT with version 0 creates). GSI/list paging:
// the opaque cursor (Rule 20.6). The rules editor and suggestions (D27) are a
// separate unit.
//
// Unit ST1 / T-ST2 (D-ST2; Design System - Settings, "Identity pickers
// (D-ST2)"; Access Control - API routes, /api/identities/directory `q`): the
// Person picker is a search box, not a list of every user.
//
// Module under test: `components/settings/access/IdentityLinksSection.tsx`
//   <IdentityLinksSection canEdit={boolean} />
// - A combobox named "Person" (a text input, no native <select>), with its
//   results as role="option" named "<display name> (<email>)". Nothing is
//   chosen until the admin picks a result: the editor appears after a pick.
// - Typing sends GET /api/identities/directory?q=<text> (trimmed) only from
//   2 characters, debounced (at most ~500 ms), showing at most 10 results.
//   GET /api/identities (the full list) is no longer requested.
// - Lists "Usage identities" and "Aliases" (each key with a remove button
//   "Remove usage identity <key>" / "Remove alias <key>"), inputs "New usage
//   identity" / "New alias" with "Add usage identity" / "Add alias" buttons,
//   read-only "LiteLLM user ID:" text with a link to the LiteLLM users tab, submit "Save links".
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const DEBOUNCE_MS = 500;
const DIRECTORY = "GET /api/identities/directory";

function dirRow(o: { oid: string; email: string; displayName: string }) {
  return {
    ...o,
    authMethod: "entra" as const,
    memberTeamId: null,
    litellm: { state: "none" as const },
    linkVersion: 0,
  };
}
const D_ALICE = dirRow({
  oid: "oid-alice",
  email: "alice@example.com",
  displayName: "Alice Adams",
});
const D_BOB = dirRow({
  oid: "oid-bob",
  email: "bob@example.com",
  displayName: "Bob Brown",
});

const LINK = {
  oid: "oid-alice",
  usageIdentities: ["alice@example.com"],
  aliases: ["alice-sso"],
  litellmUserId: "alice@example.com",
  version: 2,
  updatedAt: "2026-11-10T09:00:00.000Z",
};

function routes(extra: Record<string, unknown> = {}) {
  return {
    [DIRECTORY]: page([D_ALICE, D_BOB]),
    "GET /api/identities/oid-alice/links": LINK,
    "GET /api/identities/oid-bob/links": {
      oid: "oid-bob",
      usageIdentities: [],
      aliases: [],
      version: 0,
      updatedAt: "1970-01-01T00:00:00.000Z",
    },
    ...extra,
  };
}

async function choose(
  user: ReturnType<typeof userEvent.setup>,
  query: string,
  label: string,
) {
  await user.type(screen.getByRole("combobox", { name: "Person" }), query);
  await user.click(await screen.findByRole("option", { name: label }));
}
const ALICE_LABEL = "Alice Adams (alice@example.com)";
const BOB_LABEL = "Bob Brown (bob@example.com)";

describe("IdentityLinksSection", () => {
  it("shows the chosen person's usage identities, aliases and LiteLLM user", async () => {
    const user = userEvent.setup();
    stubAccessApi(routes());
    renderWithProviders(<IdentityLinksSection canEdit />);
    await choose(user, "ali", ALICE_LABEL);
    expect(await screen.findByText("alice-sso")).toBeInTheDocument();
    // Access Control spec - LiteLLM user links (amended 2026-11-18, M3 review
    // B1): the id is read-only here and changes only on the LiteLLM users tab.
    expect(screen.queryByLabelText("LiteLLM user ID")).not.toBeInTheDocument();
    expect(screen.getByText(/LiteLLM user ID:/).closest("p")).toHaveTextContent(
      "LiteLLM user ID: alice@example.com",
    );
    expect(screen.getByRole("link", { name: /LiteLLM users/ })).toHaveAttribute(
      "href",
      "/dashboard/manage/litellm/users",
    );
    expect(
      screen.getByRole("button", { name: "Remove alias alice-sso" }),
    ).toBeInTheDocument();
  });

  it("shows empty lists for a person with no link and sends version 0 on first save", async () => {
    const user = userEvent.setup();
    const api = stubAccessApi(
      routes({
        "PUT /api/identities/oid-bob/links": () =>
          ok({ ...LINK, oid: "oid-bob", aliases: ["bob-sso"], version: 1 }),
      }),
    );
    renderWithProviders(<IdentityLinksSection canEdit />);
    await choose(user, "bob", BOB_LABEL);
    await user.type(await screen.findByLabelText("New alias"), "bob-sso");
    await user.click(screen.getByRole("button", { name: "Add alias" }));
    await user.click(screen.getByRole("button", { name: "Save links" }));
    await vi.waitFor(() =>
      expect(api.writes()).toEqual([
        expect.objectContaining({
          method: "PUT",
          path: "/api/identities/oid-bob/links",
          body: { usageIdentities: [], aliases: ["bob-sso"], version: 0 },
        }),
      ]),
    );
  });

  it("lower-cases and trims a new alias, and refuses one already listed", async () => {
    const user = userEvent.setup();
    const api = stubAccessApi(routes());
    renderWithProviders(<IdentityLinksSection canEdit />);
    await choose(user, "ali", ALICE_LABEL);
    await screen.findByText("alice-sso");
    await user.type(screen.getByLabelText("New alias"), "  Alice-Work ");
    await user.click(screen.getByRole("button", { name: "Add alias" }));
    expect(await screen.findByText("alice-work")).toBeInTheDocument();
    await user.type(screen.getByLabelText("New alias"), "ALICE-SSO");
    await user.click(screen.getByRole("button", { name: "Add alias" }));
    expect(await screen.findByText(/already (listed|linked)/i)).toBeVisible();
    expect(api.writes()).toEqual([]);
  });

  it("saves usage identities, aliases and LiteLLM user with the loaded version", async () => {
    const user = userEvent.setup();
    const api = stubAccessApi(
      routes({
        "PUT /api/identities/oid-alice/links": () =>
          ok({ ...LINK, version: 3 }),
      }),
    );
    renderWithProviders(<IdentityLinksSection canEdit />);
    await choose(user, "ali", ALICE_LABEL);
    await screen.findByText("alice-sso");
    await user.type(
      screen.getByLabelText("New usage identity"),
      "alice.old@example.com",
    );
    await user.click(
      screen.getByRole("button", { name: "Add usage identity" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Remove alias alice-sso" }),
    );
    await user.click(screen.getByRole("button", { name: "Save links" }));
    await vi.waitFor(() =>
      expect(api.writes()).toEqual([
        expect.objectContaining({
          body: {
            usageIdentities: ["alice@example.com", "alice.old@example.com"],
            aliases: [],
            litellmUserId: "alice@example.com",
            version: 2,
          },
        }),
      ]),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(/saved/i);
  });

  // Access Control spec - LiteLLM user links (amended 2026-11-18, M3 review B1):
  // Save round-trips the stored id unchanged; a person with none sends none.
  it("sends the stored litellmUserId unchanged when an alias changes, and none for a person without one", async () => {
    const user = userEvent.setup();
    const api = stubAccessApi(
      routes({
        "PUT /api/identities/oid-alice/links": () =>
          ok({ ...LINK, version: 3 }),
        "PUT /api/identities/oid-bob/links": () =>
          ok({ ...LINK, oid: "oid-bob", litellmUserId: undefined, version: 1 }),
      }),
    );
    renderWithProviders(<IdentityLinksSection canEdit />);
    await choose(user, "ali", ALICE_LABEL);
    await screen.findByText("alice-sso");
    await user.type(screen.getByLabelText("New alias"), "alice-work");
    await user.click(screen.getByRole("button", { name: "Add alias" }));
    await user.click(screen.getByRole("button", { name: "Save links" }));
    await vi.waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]?.body).toEqual({
      usageIdentities: ["alice@example.com"],
      aliases: ["alice-sso", "alice-work"],
      litellmUserId: "alice@example.com",
      version: 2,
    });

    await user.clear(screen.getByRole("combobox", { name: "Person" }));
    await choose(user, "bob", BOB_LABEL);
    await vi.waitFor(() =>
      expect(screen.queryByText("alice-sso")).not.toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "Save links" }));
    await vi.waitFor(() => expect(api.writes()).toHaveLength(2));
    expect(api.writes()[1]?.body).not.toHaveProperty("litellmUserId");
  });

  it("maps a duplicate-key 409 to the conflict message and keeps the edits", async () => {
    const user = userEvent.setup();
    stubAccessApi(
      routes({
        "PUT /api/identities/oid-alice/links": () => fail(409, "CONFLICT"),
      }),
    );
    renderWithProviders(<IdentityLinksSection canEdit />);
    await choose(user, "ali", ALICE_LABEL);
    await screen.findByText("alice-sso");
    await user.type(screen.getByLabelText("New alias"), "taken-alias");
    await user.click(screen.getByRole("button", { name: "Add alias" }));
    await user.click(screen.getByRole("button", { name: "Save links" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /reload|another person|conflict/i,
    );
    expect(screen.getByText("taken-alias")).toBeInTheDocument();
  });

  it("is read-only for an auditor: values shown, no inputs, no save", async () => {
    const user = userEvent.setup();
    stubAccessApi(routes());
    renderWithProviders(<IdentityLinksSection canEdit={false} />);
    await choose(user, "ali", ALICE_LABEL);
    expect(await screen.findByText("alice-sso")).toBeInTheDocument();
    expect(screen.queryByLabelText("New alias")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save links" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Remove (alias|usage)/ }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("alice@example.com").length).toBeGreaterThan(0);
  });

  // T-ST2; Design System - Identity pickers (D-ST2): a search box, not a list.
  it("T-ST2: the Person picker is a search box: a combobox, no native select, no full-list request, no editor before a pick", async () => {
    const api = stubAccessApi(routes());
    renderWithProviders(<IdentityLinksSection canEdit />);
    expect(
      screen.getByRole("combobox", { name: "Person" }),
    ).toBeInTheDocument();
    expect(document.querySelector("select")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save links" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /load more people/i }),
    ).toBeNull();
    expect(api.to("GET /api/identities")).toEqual([]);
    expect(api.to(DIRECTORY)).toEqual([]);
  });

  describe("debounce (fake timers, Rule 60.24)", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    // D-ST2: fireEvent + advanceTimersByTimeAsync; userEvent hangs under fake timers.
    it("T-ST2: no request under 2 characters, however long we wait (D-ST2)", async () => {
      const api = stubAccessApi(routes());
      renderWithProviders(<IdentityLinksSection canEdit />);
      fireEvent.change(screen.getByRole("combobox", { name: "Person" }), {
        target: { value: "a" },
      });
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 4);
      expect(api.to(DIRECTORY)).toEqual([]);
    });

    it("T-ST2: debounced: nothing before the pause, one request with the whole text after it (D-ST2)", async () => {
      const api = stubAccessApi(routes());
      renderWithProviders(<IdentityLinksSection canEdit />);
      const box = screen.getByRole("combobox", { name: "Person" });
      const step = Math.floor(DEBOUNCE_MS / 4);
      for (const value of ["bo", " bob@", " bob@example.com "]) {
        fireEvent.change(box, { target: { value } });
        await vi.advanceTimersByTimeAsync(step);
      }
      expect(api.to(DIRECTORY)).toEqual([]);
      // act: the timer sets state that enables the query.
      await act(() => vi.advanceTimersByTimeAsync(DEBOUNCE_MS));
      const calls = api.to(DIRECTORY);
      expect(calls).toHaveLength(1);
      expect(new URLSearchParams(calls[0]?.search).get("q")).toBe(
        "bob@example.com",
      );
    });
  });

  it("T-ST2: shows at most 10 results even if more come back (D-ST2)", async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 12 }, (_, n) =>
      dirRow({
        oid: `oid-${n}`,
        email: `p${n}@example.com`,
        displayName: `Person ${n}`,
      }),
    );
    stubAccessApi(routes({ [DIRECTORY]: page(many) }));
    renderWithProviders(<IdentityLinksSection canEdit />);
    await user.type(screen.getByRole("combobox", { name: "Person" }), "per");
    await screen.findAllByRole("option");
    expect(screen.getAllByRole("option")).toHaveLength(10);
  });

  it("T-ST2: says so when nothing matches", async () => {
    const user = userEvent.setup();
    stubAccessApi(routes({ [DIRECTORY]: page([]) }));
    renderWithProviders(<IdentityLinksSection canEdit />);
    await user.type(screen.getByRole("combobox", { name: "Person" }), "zzz");
    expect(await screen.findByText(/no people match/i)).toBeVisible();
  });

  it("T-ST2: a result is reachable and chosen from the keyboard, then loads that person's links", async () => {
    const user = userEvent.setup();
    const api = stubAccessApi(routes());
    renderWithProviders(<IdentityLinksSection canEdit />);
    await user.type(screen.getByRole("combobox", { name: "Person" }), "br");
    await screen.findByRole("option", { name: BOB_LABEL });
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(await screen.findByRole("button", { name: "Save links" })).toBe(
      screen.getByRole("button", { name: "Save links" }),
    );
    expect(api.to("GET /api/identities/oid-bob/links")).not.toHaveLength(0);
    expect(api.to("GET /api/identities/oid-alice/links")).toHaveLength(0);
  });
});
