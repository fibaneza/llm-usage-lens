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
      screen.queryByRole("button", { name: /link|unlink|create/i }),
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
    expect(screen.queryByRole("button", { name: /link|create/i })).toBeNull();
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
    expect(screen.queryByRole("button", { name: /create|^link/i })).toBeNull();
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
