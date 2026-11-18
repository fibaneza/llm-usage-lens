import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ALICE,
  BOB,
  fail,
  identityItem,
  ok,
  page,
  stubAccessApi,
} from "@/test/fakes/access-ui-stubs";
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
// Module under test: `components/settings/access/IdentityLinksSection.tsx`
//   <IdentityLinksSection canEdit={boolean} />
// - Native <select> "Person" (options "<display name> (<email>)"), first
//   preselected, "Load more people" button when the list has a cursor.
// - Lists "Usage identities" and "Aliases" (each key with a remove button
//   "Remove usage identity <key>" / "Remove alias <key>"), inputs "New usage
//   identity" / "New alias" with "Add usage identity" / "Add alias" buttons,
//   read-only "LiteLLM user ID:" text with a link to the LiteLLM users tab, submit "Save links".
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
    "GET /api/identities": page([ALICE, BOB]),
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

describe("IdentityLinksSection", () => {
  it("shows the first person's usage identities, aliases and LiteLLM user", async () => {
    stubAccessApi(routes());
    renderWithProviders(<IdentityLinksSection canEdit />);
    expect(await screen.findByText("alice-sso")).toBeInTheDocument();
    expect(screen.getByLabelText("Person")).toHaveDisplayValue(
      "Alice Adams (alice@example.com)",
    );
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
    await user.selectOptions(
      await screen.findByLabelText("Person"),
      "Bob Brown (bob@example.com)",
    );
    await vi.waitFor(() =>
      expect(screen.queryByText("alice-sso")).not.toBeInTheDocument(),
    );
    await user.type(screen.getByLabelText("New alias"), "bob-sso");
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

    await user.selectOptions(
      screen.getByLabelText("Person"),
      "Bob Brown (bob@example.com)",
    );
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
    stubAccessApi(routes());
    renderWithProviders(<IdentityLinksSection canEdit={false} />);
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

  it("pages the people list with the opaque cursor", async () => {
    const user = userEvent.setup();
    const api = stubAccessApi(
      routes({
        "GET /api/identities": (call: { search: string }) =>
          call.search.includes("cursor=c1")
            ? ok(
                page([
                  identityItem({
                    oid: "oid-cy",
                    email: "cy@example.com",
                    displayName: "Cy Cole",
                  }),
                ]),
              )
            : ok(page([ALICE, BOB], "c1")),
      }),
    );
    renderWithProviders(<IdentityLinksSection canEdit />);
    await screen.findByText("alice-sso");
    await user.click(screen.getByRole("button", { name: /load more people/i }));
    expect(
      await screen.findByRole("option", { name: "Cy Cole (cy@example.com)" }),
    ).toBeInTheDocument();
    expect(
      api.calls.some(
        (c) => c.path === "/api/identities" && c.search.includes("cursor=c1"),
      ),
    ).toBe(true);
    expect(
      within(screen.getByLabelText("Person")).getAllByRole("option"),
    ).toHaveLength(3);
  });
});
