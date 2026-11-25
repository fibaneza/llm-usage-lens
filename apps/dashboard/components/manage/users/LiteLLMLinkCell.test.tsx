import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiResponse } from "@/test/fakes/api-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { LiteLLMLinkCell, type LinkState } from "./LiteLLMLinkCell";

// Source: Design System - Management improvements, "User link states" (D16,
// user, 2026-11-17): Linked / a match (a suggestion, linked only after
// "Link" in an AlertDialog that names both sides, never automatic; Access
// Control D27) / No LiteLLM user with that email, with two actions: Link to an
// existing LiteLLM user (a required written reason) and, on OSS only, Create
// and link; on Enterprise "Sign in to LiteLLM once, then retry." and no Create
// and link. Controls render only when the caller may write (the parent passes
// canWrite false for the auditor and the caller's own row). Renamed and
// changed 2026-11-25 (unit UP1, D-R3-11, D-R3-12): the action reads "Create
// LiteLLM user" and the "Match found" badge is gone. The route decides
// every write again; route logic is tested in the route's file (Rule 60.24a).
const SUBJECT = {
  oid: "oid-ada",
  name: "Ada Lovelace",
  email: "ada@example.com" as string | null,
  version: 4,
};

const SEARCH = {
  users: [{ userId: "ll-other", email: "ada.l@lite.example.com", teams: [] }],
  page: 1,
  pageSize: 25,
  enabledOperations: [],
};

type Call = { url: string; method: string; body: unknown };
function stubWrites(response: Response = apiResponse({ data: {} })) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: new URL(String(input), "http://localhost").pathname,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return Promise.resolve(response);
    }),
  );
  return calls;
}

function show(
  link: LinkState,
  over: Partial<{ canWrite: boolean; canCreate: boolean }> = {},
) {
  const onChanged = vi.fn();
  renderWithProviders(
    <LiteLLMLinkCell
      subject={SUBJECT}
      link={link}
      canWrite={over.canWrite ?? true}
      canCreate={over.canCreate ?? true}
      onChanged={onChanged}
    />,
  );
  return onChanged;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LiteLLMLinkCell states (D16)", () => {
  it("Linked shows the LiteLLM user and an Unlink action for a writer", () => {
    show({ state: "linked", litellmUserId: "ll-ada" });
    expect(screen.getByText("Linked")).toBeInTheDocument();
    expect(screen.getByText("ll-ada")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /unlink/i })).toBeInTheDocument();
  });

  it.each<[string, LinkState, string]>([
    ["linked", { state: "linked", litellmUserId: "ll-ada" }, "Linked"],
    [
      "match",
      { state: "match", litellmUserId: "ll-ada", email: "ada@example.com" },
      "ada@example.com",
    ],
    ["none", { state: "none" }, "No LiteLLM user with that email"],
  ])(
    "%s state without write rights shows the state and no control (D16: the auditor reads; own row)",
    (_n, link, label) => {
      show(link, { canWrite: false });
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.queryAllByRole("button")).toHaveLength(0);
    },
  );
});

describe("LiteLLMLinkCell match (D16, D27: never automatic)", () => {
  const MATCH: LinkState = {
    state: "match",
    litellmUserId: "ll-ada",
    email: "ada@lite.example.com",
  };

  it("Link opens a dialog naming both sides and writes nothing until confirmed", async () => {
    const calls = stubWrites();
    show(MATCH);
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /^link /i }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Ada Lovelace");
    expect(dialog).toHaveTextContent("ada@example.com");
    expect(dialog).toHaveTextContent("ada@lite.example.com");
    expect(calls).toEqual([]);
  });

  it("Cancel writes nothing; Link PUTs the match with the stored version", async () => {
    const calls = stubWrites(
      apiResponse({
        data: { oid: "oid-ada", litellmUserId: "ll-ada", version: 5 },
      }),
    );
    const onChanged = show(MATCH);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^link /i }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(calls).toEqual([]);

    await user.click(screen.getByRole("button", { name: /^link /i }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Link",
      }),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(calls).toEqual([
      {
        url: "/api/identities/oid-ada/litellm-link",
        method: "PUT",
        body: { litellmUserId: "ll-ada", mode: "match", version: 4 },
      },
    ]);
  });

  it("shows the refusal of a privileged target without closing silently (T-MI1: PRIVILEGED_TARGET)", async () => {
    stubWrites(
      apiResponse(
        { error: { code: "PRIVILEGED_TARGET", message: "refused" } },
        409,
      ),
    );
    const onChanged = show(MATCH);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^link /i }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Link",
      }),
    );
    expect(
      await screen.findByText(/administrator account/i),
    ).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe("LiteLLMLinkCell no LiteLLM user (D16)", () => {
  const NONE: LinkState = { state: "none" };

  it("OSS: offers Link to an existing LiteLLM user and Create LiteLLM user", () => {
    show(NONE, { canCreate: true });
    expect(
      screen.getByRole("button", { name: "Link to an existing LiteLLM user" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create LiteLLM user" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/sign in to litellm once/i)).toBeNull();
  });

  it("Enterprise: no Create LiteLLM user, and the row says to sign in to LiteLLM once", () => {
    show(NONE, { canCreate: false });
    expect(
      screen.getByRole("button", { name: "Link to an existing LiteLLM user" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Create LiteLLM user" }),
    ).toBeNull();
    expect(
      screen.getByText("Sign in to LiteLLM once, then retry."),
    ).toBeInTheDocument();
  });

  it("Create LiteLLM user confirms first, then POSTs only the oid", async () => {
    const calls = stubWrites(
      apiResponse({
        data: {
          oid: "oid-ada",
          litellmUserId: "ll-new",
          created: true,
          version: 1,
        },
      }),
    );
    const onChanged = show(NONE);
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Create LiteLLM user" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(calls).toEqual([]);
    await user.click(
      within(dialog).getByRole("button", { name: "Create LiteLLM user" }),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(calls).toEqual([
      { url: "/api/litellm/users", method: "POST", body: { oid: "oid-ada" } },
    ]);
  });

  it("a manual link needs a written reason: submitting without one writes nothing (D16)", async () => {
    const calls = stubWrites(
      apiResponse({
        data: {
          ...SEARCH,
        },
      }),
    );
    show(NONE);
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Link to an existing LiteLLM user" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.type(
      within(dialog).getByLabelText("Search LiteLLM users"),
      "ada.l",
    );
    await user.click(
      await within(dialog).findByRole(
        "radio",
        { name: /ada\.l@lite/ },
        { timeout: 4000 },
      ),
    );
    await user.click(within(dialog).getByRole("button", { name: "Link user" }));

    expect(await within(dialog).findByText(/1 to 280/)).toBeInTheDocument();
    expect(calls.filter((c) => c.method === "PUT")).toEqual([]);
  });

  it("a manual link PUTs mode manual with the reason, the picked id and the version", async () => {
    const calls: Call[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), "http://localhost");
        calls.push({
          url: url.pathname,
          method: init?.method ?? "GET",
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        if (url.pathname === "/api/litellm/users") {
          return Promise.resolve(
            apiResponse({
              data: {
                ...SEARCH,
              },
            }),
          );
        }
        return Promise.resolve(
          apiResponse({
            data: { oid: "oid-ada", litellmUserId: "ll-other", version: 5 },
          }),
        );
      }),
    );
    const onChanged = show({ state: "none" });
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Link to an existing LiteLLM user" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.type(
      within(dialog).getByLabelText("Search LiteLLM users"),
      "ada.l",
    );
    await user.click(
      await within(dialog).findByRole(
        "radio",
        { name: /ada\.l@lite/ },
        { timeout: 4000 },
      ),
    );
    await user.type(
      within(dialog).getByLabelText("Reason"),
      "Same person, old address",
    );
    await user.click(within(dialog).getByRole("button", { name: "Link user" }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(calls.find((c) => c.method === "PUT")).toEqual({
      url: "/api/identities/oid-ada/litellm-link",
      method: "PUT",
      body: {
        litellmUserId: "ll-other",
        mode: "manual",
        reason: "Same person, old address",
        version: 4,
      },
    });
  });
});

describe("LiteLLMLinkCell unlink (D16)", () => {
  it("Remove link DELETEs with the version after a confirmation", async () => {
    const calls = stubWrites(
      apiResponse({
        data: { oid: "oid-ada", litellmUserId: null, version: 5 },
      }),
    );
    const onChanged = show({ state: "linked", litellmUserId: "ll-ada" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /unlink/i }));
    const dialog = await screen.findByRole("alertdialog");
    expect(calls).toEqual([]);
    await user.click(
      within(dialog).getByRole("button", { name: "Remove link" }),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(calls).toEqual([
      {
        url: "/api/identities/oid-ada/litellm-link",
        method: "DELETE",
        body: { version: 4 },
      },
    ]);
  });
});

// Design System - Users, round 3 (unit UP1; D-R3-10, D-R3-11, D-R3-12), the
// FieldHelp text table.
describe("LiteLLMLinkCell round 3 (T-UP1, T-UP2)", () => {
  const help = (field: string) =>
    screen.getByRole("button", { name: `About ${field}` });

  it("T-UP1: the create action and its dialog read 'Create LiteLLM user', never 'Create and link', with its help text", async () => {
    stubWrites();
    show({ state: "none" }, { canCreate: true });
    expect(
      screen.getByRole("button", { name: "Create LiteLLM user" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/create and link/i)).toBeNull();
    const user = userEvent.setup();
    await user.click(help("Create LiteLLM user"));
    expect(
      await screen.findByText(
        "Creates a user in LiteLLM with this person's email and links it to this person. It sets no team, key or budget.",
      ),
    ).toBeVisible();
    await user.keyboard("{Escape}");
    await user.click(
      screen.getByRole("button", { name: "Create LiteLLM user" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByRole("button", { name: "Create LiteLLM user" }),
    ).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent(/create and link/i);
  });

  it("T-UP1 (LW1 gate): with createUser unavailable there is no create action and no create help", () => {
    show({ state: "none" }, { canCreate: false });
    expect(
      screen.queryByRole("button", { name: "Create LiteLLM user" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "About Create LiteLLM user" }),
    ).toBeNull();
  });

  it("T-UP1: 'Link to an existing LiteLLM user' carries its help text", async () => {
    show({ state: "none" });
    await userEvent.setup().click(help("Link to an existing LiteLLM user"));
    expect(
      await screen.findByText(
        "Connects this person to a LiteLLM user that already exists, so their LiteLLM spend shows here. Nothing changes in LiteLLM.",
      ),
    ).toBeVisible();
  });

  it("T-UP2: a match shows the LiteLLM email and Link, no 'Match found' badge, and 'Link (a match)' help", async () => {
    show({
      state: "match",
      litellmUserId: "ll-ada",
      email: "ada@lite.example.com",
    });
    expect(screen.queryByText(/match found/i)).toBeNull();
    expect(screen.getByText("ada@lite.example.com")).toBeVisible();
    expect(screen.getByRole("button", { name: /^link /i })).toBeVisible();
    await userEvent.setup().click(help("Link (a match)"));
    expect(
      await screen.findByText(
        "A LiteLLM user has the same email. Link connects the two after you confirm.",
      ),
    ).toBeVisible();
  });

  it("T-UP1/T-UP2: no write right means no action and no help button (the auditor reads)", () => {
    show({ state: "none" }, { canWrite: false });
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});

// Design System - Accessibility (a field's label and hint) and WCAG 3.3.2
// (Labels or Instructions): the LiteLLM user search in the link dialog names
// what it accepts as text, not only as a placeholder, and turns browser
// autofill off (a LiteLLM user id is not the caller's own data).
describe("LiteLLMLinkCell link dialog search (WCAG 3.3.2)", () => {
  it("the search box has the hint 'Email or user id.' as visible text or via aria-describedby, and autoComplete off", async () => {
    show({ state: "none" });
    await userEvent.setup().click(
      screen.getByRole("button", {
        name: "Link to an existing LiteLLM user",
      }),
    );
    const dialog = await screen.findByRole("dialog");
    const box = within(dialog).getByRole("searchbox", {
      name: "Search LiteLLM users",
    });
    expect(box).toHaveAttribute("autocomplete", "off");
    const ids = (box.getAttribute("aria-describedby") ?? "")
      .split(/\s+/)
      .filter(Boolean);
    const described = ids
      .map((id) => dialog.ownerDocument.getElementById(id)?.textContent ?? "")
      .join(" ");
    const hint = "Email or user id.";
    expect(
      described.includes(hint) || within(dialog).queryByText(hint) !== null,
    ).toBe(true);
  });
});
