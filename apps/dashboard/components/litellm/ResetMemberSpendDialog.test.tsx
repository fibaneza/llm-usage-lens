import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiError, apiResponse } from "@/test/fakes/api-stubs";
import { macrotask } from "@/test/support/fetch-hold";
import { renderWithProviders } from "@/test/support/render-providers";

import { ResetMemberSpendDialog } from "./ResetMemberSpendDialog";

// Sources: Design System - "Reset spend from the LiteLLM users tab and the
// Users page" (unit RS1, D1-D5): a dialog listing the person's resettable
// LiteLLM team memberships, each with its spend and budget ("No budget" when
// unlimited, D5) and its own confirm; "Reset all listed" runs the per-team
// resets one at a time and reports each team's result (D2); every reset is the
// existing POST /api/litellm/teams/[teamId]/members/[oid]/reset-spend (D3);
// Management pages - *Confirm destructive actions* (the AlertDialog names the
// person and the effect, Cancel focused first, Escape closes and returns focus
// to the trigger); LiteLLM spec LD23 (spend hidden under the Organisation cap)
// and LD37 (not configured). Which rows carry the action is asserted with the
// two lists (LiteLLMUsersList.test.tsx, UsersPeoplePanel.test.tsx); the read's
// scoping is asserted with the route (Rule 60.24a).
//
// Contract: components/litellm/ResetMemberSpendDialog.tsx exports
//   ResetMemberSpendDialog({ oid, litellmUserId, name }: { oid: string;
//   litellmUserId: string; name: string })
// - it renders the trigger (button "Reset spend", accessible name
//   `Reset spend for ${name}`) and an AlertDialog opened by it (role
//   alertdialog, title `Reset spend for ${name}?`). Nothing is fetched until it
//   opens. On open it GETs /api/litellm/users/${litellmUserId}/memberships
//   (LiteLLMUserMembershipsResponseSchema) and shows, while pending, a Skeleton.
// - a list (role list, name "Team memberships"); one listitem per team with the
//   team name, "Spend" and "Budget" values (formatUsd; "No budget" only when
//   maxBudget is null or absent, a 0 budget is "$0.00" - ruling R1; spend "Hidden until per-user reporting is approved"
//   when absent) and a button `Reset spend in ${teamName}` (text "Reset").
// - the footer: "Reset all listed" (only when the list is not empty) and
//   "Cancel".
// - a reset POSTs `/api/litellm/teams/${teamId}/members/${oid}/reset-spend`
//   (encodeURIComponent each segment), no body; success shows
//   "Spend reset to $0.00" in the row and disables its button; a failure shows
//   `Failed: ${error.message}` in the row (role alert) and keeps it enabled.
// - "Reset all listed" POSTs the rows not yet reset ONE AT A TIME in list order,
//   continues after a failure, and ends with a result in every row.
// - empty list: "No team you can reset spend in for this person."; not
//   configured: "LiteLLM not configured"; 503: "LiteLLM unavailable".
const ADA = { oid: "oid-ada", litellmUserId: "ll-ada", name: "Ada Lovelace" };
const A = { teamId: "team-a", teamName: "Payments", spend: 6, maxBudget: 10 };
const B = { teamId: "team-b", teamName: "Growth", spend: 2, maxBudget: null };

type Post = { url: string; init?: RequestInit | undefined };

// apiResponse()/apiError() return plain objects cast to Response (no Response
// instance), so detect them by their json() method; a memberships body never
// carries one.
function isApiResponse(value: unknown): value is Response {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { json?: unknown }).json === "function"
  );
}

function stub(
  memberships: unknown,
  post: (url: string, call: number) => Response | Promise<Response> = () =>
    apiResponse({ data: { oid: ADA.oid, litellmUserId: ADA.litellmUserId } }),
) {
  const posts: Post[] = [];
  const gets: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      if ((init?.method ?? "GET") === "POST") {
        posts.push({ url: url.pathname, init });
        return Promise.resolve(post(url.pathname, posts.length));
      }
      gets.push(url.pathname);
      return Promise.resolve(
        isApiResponse(memberships)
          ? memberships
          : apiResponse({ data: memberships }),
      );
    }),
  );
  return { posts, gets };
}

const resetUrl = (team: string) =>
  `/api/litellm/teams/${team}/members/${ADA.oid}/reset-spend`;

async function open() {
  const user = userEvent.setup();
  renderWithProviders(<ResetMemberSpendDialog {...ADA} />);
  const trigger = screen.getByRole("button", {
    name: "Reset spend for Ada Lovelace",
  });
  await user.click(trigger);
  const dialog = await screen.findByRole("alertdialog");
  return { user, trigger, dialog };
}
const rowOf = (team: string) => {
  const list = screen.getByRole("list", { name: "Team memberships" });
  const row = within(list)
    .getAllByRole("listitem")
    .find((li) => li.textContent?.includes(team));
  if (!row) throw new Error(`no row for ${team}`);
  return row;
};

afterEach(() => vi.unstubAllGlobals());

describe("ResetMemberSpendDialog (RS1)", () => {
  it("fetches nothing until the dialog is opened, then reads the person's memberships (D2)", async () => {
    const calls = stub({ items: [A] });
    renderWithProviders(<ResetMemberSpendDialog {...ADA} />);
    const trigger = screen.getByRole("button", {
      name: "Reset spend for Ada Lovelace",
    });
    expect(trigger).toHaveTextContent("Reset spend");
    expect(calls.gets).toEqual([]);
    await userEvent.click(trigger);
    await screen.findByRole("list", { name: "Team memberships" });
    expect(calls.gets).toEqual(["/api/litellm/users/ll-ada/memberships"]);
  });

  it("names the person and the effect, with Cancel focused first (Confirm destructive actions)", async () => {
    stub({ items: [A] });
    const { dialog } = await open();
    expect(
      within(dialog).getByText("Reset spend for Ada Lovelace?"),
    ).toBeInTheDocument();
    expect(dialog).toHaveAccessibleDescription(
      /Ada Lovelace.*\$0\.00.*audit log/s,
    );
    expect(
      within(dialog).getByRole("button", { name: "Cancel" }),
    ).toHaveFocus();
  });

  it("shows a skeleton while the memberships load (loading state)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    const { dialog } = await open();
    expect(dialog.querySelector('[data-slot="skeleton"]')).not.toBeNull();
  });

  it("lists each team with its spend and budget, and 'No budget' for an unlimited one (D2, D5)", async () => {
    stub({ items: [A, B] });
    await open();
    await screen.findByRole("list", { name: "Team memberships" });
    const payments = rowOf("Payments");
    expect(payments).toHaveTextContent("$6.00");
    expect(payments).toHaveTextContent("$10.00");
    expect(
      within(payments).getByRole("button", { name: "Reset spend in Payments" }),
    ).toBeEnabled();
    const growth = rowOf("Growth");
    expect(growth).toHaveTextContent("$2.00");
    expect(growth).toHaveTextContent("No budget");
    expect(growth).not.toHaveTextContent("$0.00");
  });

  // Source: Design System - Reset spend (coordinator ruling R1, 2026-11-18): a
  // budget of 0 blocks all spend in LiteLLM, so it reads "$0.00", never
  // "No budget"; only an unlimited (null) or absent budget reads "No budget".
  it("a budget of 0 shows $0.00, and only a null or absent budget shows 'No budget' (R1, D5)", async () => {
    stub({
      items: [
        { teamId: "team-z", teamName: "Zero", spend: 1, maxBudget: 0 },
        B,
        { teamId: "team-n", teamName: "Nobudget", spend: 3 },
      ],
    });
    await open();
    await screen.findByRole("list", { name: "Team memberships" });
    expect(rowOf("Zero")).toHaveTextContent("$0.00");
    expect(rowOf("Zero")).not.toHaveTextContent("No budget");
    expect(rowOf("Growth")).toHaveTextContent("No budget");
    expect(rowOf("Nobudget")).toHaveTextContent("No budget");
  });

  it("under the Organisation cap the teams stay listed and the spend is hidden (LD23)", async () => {
    stub({ items: [{ teamId: "team-a", teamName: "Payments" }] });
    await open();
    await screen.findByRole("list", { name: "Team memberships" });
    expect(rowOf("Payments")).toHaveTextContent(
      "Hidden until per-user reporting is approved",
    );
  });

  it("confirming one team POSTs the existing reset-spend route for that team and person, nothing else (D3)", async () => {
    const calls = stub({ items: [A, B] });
    const { user } = await open();
    await screen.findByRole("list", { name: "Team memberships" });
    await user.click(
      within(rowOf("Growth")).getByRole("button", {
        name: "Reset spend in Growth",
      }),
    );
    await waitFor(() =>
      expect(rowOf("Growth")).toHaveTextContent("Spend reset to $0.00"),
    );
    expect(calls.posts.map((p) => p.url)).toEqual([resetUrl("team-b")]);
    expect(calls.posts[0]?.init?.body).toBeUndefined();
    expect(
      within(rowOf("Growth")).getByRole("button", {
        name: "Reset spend in Growth",
      }),
    ).toBeDisabled();
    expect(rowOf("Payments")).not.toHaveTextContent("Spend reset");
  });

  it("a failed reset shows the server's message in that row and keeps its button usable (D2)", async () => {
    stub({ items: [A] }, () =>
      apiError(409, "CONFLICT", "The person has not signed in to LiteLLM yet"),
    );
    const { user } = await open();
    await screen.findByRole("list", { name: "Team memberships" });
    await user.click(
      screen.getByRole("button", { name: "Reset spend in Payments" }),
    );
    const alert = await within(rowOf("Payments")).findByRole("alert");
    expect(alert).toHaveTextContent(
      "Failed: The person has not signed in to LiteLLM yet",
    );
    expect(
      screen.getByRole("button", { name: "Reset spend in Payments" }),
    ).toBeEnabled();
  });

  it("'Reset all listed' sends the resets one at a time in list order and reports each team, continuing after a failure (D2)", async () => {
    const gates: Array<(r: Response) => void> = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const calls = stub({ items: [A, B] }, () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise<Response>((resolve) => {
        gates.push((r) => {
          inFlight -= 1;
          resolve(r);
        });
      });
    });
    const { user } = await open();
    await screen.findByRole("list", { name: "Team memberships" });
    await user.click(screen.getByRole("button", { name: "Reset all listed" }));

    await waitFor(() => expect(calls.posts).toHaveLength(1));
    expect(calls.posts[0]?.url).toBe(resetUrl("team-a"));
    // The second call waits for the first to finish.
    await macrotask();
    expect(calls.posts).toHaveLength(1);

    gates[0]?.(apiError(500, "INTERNAL_ERROR", "boom"));
    await waitFor(() => expect(calls.posts).toHaveLength(2));
    expect(calls.posts[1]?.url).toBe(resetUrl("team-b"));
    gates[1]?.(
      apiResponse({ data: { oid: ADA.oid, litellmUserId: "ll-ada" } }),
    );

    await waitFor(() =>
      expect(rowOf("Growth")).toHaveTextContent("Spend reset to $0.00"),
    );
    expect(rowOf("Payments")).toHaveTextContent("Failed: boom");
    expect(maxInFlight).toBe(1);
  });

  it("'Reset all listed' skips the teams already reset (D2)", async () => {
    const calls = stub({ items: [A, B] });
    const { user } = await open();
    await screen.findByRole("list", { name: "Team memberships" });
    await user.click(
      screen.getByRole("button", { name: "Reset spend in Payments" }),
    );
    await waitFor(() =>
      expect(rowOf("Payments")).toHaveTextContent("Spend reset to $0.00"),
    );
    await user.click(screen.getByRole("button", { name: "Reset all listed" }));
    await waitFor(() => expect(calls.posts).toHaveLength(2));
    expect(calls.posts.map((p) => p.url)).toEqual([
      resetUrl("team-a"),
      resetUrl("team-b"),
    ]);
  });

  it.each([
    [
      "has no resettable team",
      { items: [] },
      "No team you can reset spend in for this person.",
    ],
    [
      "LiteLLM is not configured (LD37)",
      { configured: false, items: [] },
      "LiteLLM not configured",
    ],
  ])(
    "when the person %s, it says so and offers no reset",
    async (_n, body, text) => {
      stub(body);
      const { dialog } = await open();
      expect(await within(dialog).findByText(text)).toBeInTheDocument();
      expect(
        within(dialog).queryByRole("button", { name: /^Reset/ }),
      ).toBeNull();
      expect(
        within(dialog).getByRole("button", { name: "Cancel" }),
      ).toBeVisible();
    },
  );

  it("a LiteLLM outage shows 'LiteLLM unavailable', not an error page (States)", async () => {
    stub(apiError(503, "LITELLM_UNAVAILABLE", "LiteLLM unavailable"));
    const { dialog } = await open();
    expect(
      await within(dialog).findByText("LiteLLM unavailable"),
    ).toBeInTheDocument();
  });

  it("Escape closes the dialog and returns focus to the trigger (a11y)", async () => {
    stub({ items: [A] });
    const { user, trigger } = await open();
    await screen.findByRole("list", { name: "Team memberships" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(trigger).toHaveFocus();
  });
});

// RS2 (Design System - "Reset any LiteLLM user", D-RS7/D-RS9; LiteLLM LD39).
// Contract additions to ResetMemberSpendDialog (existing props keep working):
//   - `oid` becomes optional (a LiteLLM user with no app identity) and a new
//     optional prop `userReset?: boolean` (default false) shows the user-level
//     option, passed by the callers whose role may use it;
//   - the option is a `role="group"` named "User spend (all of LiteLLM)",
//     rendered BEFORE the "Team memberships" list, with a button named
//     "Reset user spend in all of LiteLLM" (text "Reset"); it POSTs
//     /api/litellm/users/${litellmUserId}/reset-spend (no body) and shows
//     "Spend reset to $0.00" in the group, or `Failed: ${message}` (role alert);
//   - the dialog description says a reset clears the spend counter and that usage
//     history, cost data and the audit log do not change (D-RS9); the group says
//     the reset clears spend across all of the person's teams;
//   - "Reset all listed" never includes the user-level reset.
describe("ResetMemberSpendDialog user-level option (RS2)", () => {
  const userUrl = "/api/litellm/users/ll-ada/reset-spend";
  const openWith = async (props: {
    oid?: string;
    userReset?: boolean;
  }): Promise<{ user: ReturnType<typeof userEvent.setup> }> => {
    const user = userEvent.setup();
    renderWithProviders(
      <ResetMemberSpendDialog
        litellmUserId={ADA.litellmUserId}
        name={ADA.name}
        {...props}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Reset spend for Ada Lovelace" }),
    );
    await screen.findByRole("alertdialog");
    return { user };
  };
  const group = () =>
    screen.findByRole("group", { name: "User spend (all of LiteLLM)" });

  it("lists 'User spend (all of LiteLLM)' first, before the team memberships (D-RS7)", async () => {
    stub({ items: [A] });
    await openWith({ oid: ADA.oid, userReset: true });
    const option = await group();
    const list = await screen.findByRole("list", { name: "Team memberships" });
    expect(
      option.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("offers no user-level option unless userReset is set (D-RS3, existing props keep working)", async () => {
    stub({ items: [A] });
    await openWith({ oid: ADA.oid });
    await screen.findByRole("list", { name: "Team memberships" });
    expect(
      screen.queryByRole("group", { name: "User spend (all of LiteLLM)" }),
    ).toBeNull();
  });

  it("says usage history, cost data and the audit log do not change, and that all of the person's teams are cleared (D-RS9)", async () => {
    stub({ items: [A] });
    await openWith({ oid: ADA.oid, userReset: true });
    const option = await group();
    expect(option).toHaveTextContent(/all of (their|the person's) teams/i);
    const dialog = screen.getByRole("alertdialog");
    for (const phrase of [/usage history/i, /cost data/i, /audit log/i]) {
      expect(dialog).toHaveAccessibleDescription(phrase);
    }
  });

  it("confirming it POSTs the LiteLLM-id user route, no body, and reports $0.00 (D-RS4)", async () => {
    const calls = stub({ items: [A] });
    const { user } = await openWith({ oid: ADA.oid, userReset: true });
    const option = await group();
    await user.click(
      within(option).getByRole("button", {
        name: "Reset user spend in all of LiteLLM",
      }),
    );
    await waitFor(() =>
      expect(option).toHaveTextContent("Spend reset to $0.00"),
    );
    expect(calls.posts.map((p) => p.url)).toEqual([userUrl]);
    expect(calls.posts[0]?.init?.body).toBeUndefined();
  });

  it("a failed user-level reset shows the server's message in the group (D-RS5 409)", async () => {
    stub({ items: [A] }, () =>
      apiError(409, "PRIVILEGED_TARGET", "This LiteLLM user cannot be reset"),
    );
    const { user } = await openWith({ oid: ADA.oid, userReset: true });
    const option = await group();
    await user.click(
      within(option).getByRole("button", {
        name: "Reset user spend in all of LiteLLM",
      }),
    );
    expect(await within(option).findByRole("alert")).toHaveTextContent(
      "Failed: This LiteLLM user cannot be reset",
    );
  });

  it("a person with no app identity (no oid) can still be reset by LiteLLM id (D-RS4, item 18)", async () => {
    const calls = stub({ items: [] });
    const { user } = await openWith({ userReset: true });
    const option = await group();
    expect(calls.gets).toEqual(["/api/litellm/users/ll-ada/memberships"]);
    await user.click(
      within(option).getByRole("button", {
        name: "Reset user spend in all of LiteLLM",
      }),
    );
    await waitFor(() =>
      expect(calls.posts.map((p) => p.url)).toEqual([userUrl]),
    );
  });

  it("'Reset all listed' sends the team resets only, never the user-level reset (D-RS7)", async () => {
    const calls = stub({ items: [A, B] });
    const { user } = await openWith({ oid: ADA.oid, userReset: true });
    await screen.findByRole("list", { name: "Team memberships" });
    await user.click(screen.getByRole("button", { name: "Reset all listed" }));
    await waitFor(() => expect(calls.posts).toHaveLength(2));
    expect(calls.posts.map((p) => p.url)).not.toContain(userUrl);
  });

  // Q-B2 (review r1; Design System "absent, never dead", D-RS2): the dialog
  // takes the enabled operations as a prop `enabledOperations?: string[]`
  // (omitted = every control, so the existing callers and cases keep working).
  // Given, the per-team "Reset spend in ${team}" buttons and "Reset all listed"
  // show only with "resetMemberSpend", the user-level group only with
  // "resetUserSpend" (with userReset).
  it.each([
    [["resetMemberSpend", "resetUserSpend"], true, true],
    [["resetMemberSpend"], false, true],
    [["resetUserSpend"], true, false],
  ] as const)(
    "enabledOperations %j: user-level %s, per-team reset and 'Reset all listed' %s (Q-B2)",
    async (enabledOperations, userLevel, perTeam) => {
      stub({ items: [A, B] });
      const user = userEvent.setup();
      renderWithProviders(
        <ResetMemberSpendDialog
          {...ADA}
          userReset
          enabledOperations={[...enabledOperations]}
        />,
      );
      await user.click(
        screen.getByRole("button", { name: "Reset spend for Ada Lovelace" }),
      );
      const dialog = await screen.findByRole("alertdialog");
      await within(dialog).findByRole("list", { name: "Team memberships" });
      expect(
        within(dialog).queryByRole("group", {
          name: "User spend (all of LiteLLM)",
        }) !== null,
      ).toBe(userLevel);
      expect(
        within(dialog).queryByRole("button", {
          name: "Reset spend in Payments",
        }) !== null,
      ).toBe(perTeam);
      expect(
        within(dialog).queryByRole("button", { name: "Reset all listed" }) !==
          null,
      ).toBe(perTeam);
    },
  );
});
