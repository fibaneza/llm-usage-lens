import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fail, ok, stubAccessApi } from "@/test/fakes/access-ui-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { AcceptInviteDialog } from "./AcceptInviteDialog";

// Sources: Access Control - "Accept a pending invite" (INV1: server-computed
// candidates, the key shown against UPN and email with the mismatch marked,
// required reason 1-280, refusals), "API routes" rows .../candidates (GET,
// `?q=` for internal-admin and internal-org-admin only, at most 10 rows: oid,
// displayName, upn, email) and .../accept (POST { oid, reason }); threats
// T-INV1, T-INV3, T-INV4, T-INV6; Design System - Management improvements,
// "Accept a pending invite" (AlertDialog names the person and the team; no
// candidate -> say so, nothing to type); Rule 60.24a.
//
// Module under test: `components/settings/access/AcceptInviteDialog.tsx`
//   <AcceptInviteDialog
//     teamId="team-pay" teamName="Payments" inviteKey="jane@example.com"
//     canSearch={boolean}            // admin / org-admin only
//     onClose={() => void}
//     onAccepted={(oid: string) => void} />
// Opens as role "dialog" and loads GET /api/teams/<teamId>/members/pending/
// <encodeURIComponent(inviteKey)>/candidates; the response is
// { data: { items: Candidate[] } } (page shape of every access list).
// Candidates are radios named by displayName; a textbox "Reason"; button
// "Confirm" opens an alertdialog whose action is "Add to team".
// INV2 (Access Control - "Placing a person by hand"): each candidate row also
// carries `exact` (boolean) and `signal` ("upn" | "guest-upn" | "email" |
// "litellm-link"); the dialog preselects a candidate only when exactly one is
// exact, never an email-only one (T-IV2), the reason stays required, and the
// dialog is titled "Approve and add <key>" (it replaces "Accept invite").
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const KEY = "jane@example.com";
const BASE = `/api/teams/team-pay/members/pending/${KEY}`;
const CANDIDATES = `GET ${BASE}/candidates`;
const ACCEPT = `POST ${BASE}/accept`;
const guest = {
  oid: "oid-jane",
  displayName: "Jane Doe",
  upn: "jane_example.com#EXT#@tenant.onmicrosoft.com",
  email: "jane@example.com",
  exact: false,
  signal: "guest-upn",
};
const exact = {
  oid: "oid-other",
  displayName: "Jane Other",
  upn: "jane@example.com",
  email: "jane@example.com",
  exact: true,
  signal: "upn",
};
const list = (...items: unknown[]) => ({ items });

function setup(routes: Record<string, unknown>, { canSearch = false } = {}) {
  const api = stubAccessApi(routes);
  const onClose = vi.fn();
  const onAccepted = vi.fn();
  renderWithProviders(
    <AcceptInviteDialog
      teamId="team-pay"
      teamName="Payments"
      inviteKey={KEY}
      canSearch={canSearch}
      onClose={onClose}
      onAccepted={onAccepted}
    />,
  );
  return { api, onClose, onAccepted };
}

async function fillAndConfirm(
  user: ReturnType<typeof userEvent.setup>,
  who = /Jane Doe/,
  reason = "Same person, guest UPN",
) {
  const dialog = await screen.findByRole("dialog");
  await user.click(await within(dialog).findByRole("radio", { name: who }));
  await user.type(within(dialog).getByLabelText(/reason/i), reason);
  await user.click(within(dialog).getByRole("button", { name: "Confirm" }));
}

describe("AcceptInviteDialog", () => {
  it("lists the candidates with name, UPN and email (T-INV1: server-computed only)", async () => {
    setup({ [CANDIDATES]: list(guest, exact) });
    const jane = await screen.findByRole("radio", { name: /Jane Doe/ });
    expect(jane.closest("label, li, div")).toHaveTextContent(guest.upn);
    expect(jane.closest("label, li, div")).toHaveTextContent(guest.email);
    expect(screen.getByRole("radio", { name: /Jane Other/ })).toBeVisible();
  });

  it("marks where the UPN or email differs from the invite key, and only there", async () => {
    setup({
      [CANDIDATES]: list(guest, exact, {
        oid: "oid-x",
        displayName: "Xavier",
        upn: "x@corp.example.com",
        email: "jane.d@example.com",
        exact: false,
        signal: "email",
      }),
    });
    await screen.findByRole("radio", { name: /Jane Doe/ });
    const rowOf = (n: RegExp) =>
      screen.getByRole("radio", { name: n }).closest("label, li, div")!;
    expect(rowOf(/Jane Doe/)).toHaveTextContent(/UPN differs/i);
    expect(rowOf(/Jane Doe/)).not.toHaveTextContent(/email differs/i);
    expect(rowOf(/Jane Other/)).not.toHaveTextContent(/differs/i);
    expect(rowOf(/Xavier/)).toHaveTextContent(/UPN differs/i);
    expect(rowOf(/Xavier/)).toHaveTextContent(/email differs/i);
  });

  it("offers no search box to a lead (D37: no free search over people)", async () => {
    setup({ [CANDIDATES]: list(guest) }, { canSearch: false });
    await screen.findByRole("radio", { name: /Jane Doe/ });
    expect(
      screen.queryByRole("textbox", { name: /search/i }),
    ).not.toBeInTheDocument();
  });

  it("offers a search box to an admin and passes ?q= to the candidates read", async () => {
    const user = userEvent.setup();
    const { api } = setup(
      {
        [CANDIDATES]: (call: { search: string }) =>
          ok(
            call.search.includes("q=carol")
              ? list({
                  oid: "oid-carol",
                  displayName: "Carol Chen",
                  upn: "carol@corp.example.com",
                  email: "carol@example.com",
                  exact: false,
                  signal: "email",
                })
              : list(guest),
          ),
      },
      { canSearch: true },
    );
    await screen.findByRole("radio", { name: /Jane Doe/ });
    await user.type(screen.getByRole("textbox", { name: /search/i }), "carol");
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(
      await screen.findByRole("radio", { name: /Carol Chen/ }),
    ).toBeVisible();
    expect(api.to(CANDIDATES).some((c) => c.search.includes("q=carol"))).toBe(
      true,
    );
  });

  it("with no candidate it says so and offers nothing to type", async () => {
    setup({ [CANDIDATES]: list() });
    expect(await screen.findByText(/no candidate/i)).toBeVisible();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
  });

  it("with no candidate and a searching admin, the search box stays (admins may pick from the directory)", async () => {
    setup({ [CANDIDATES]: list() }, { canSearch: true });
    expect(await screen.findByText(/no candidate/i)).toBeVisible();
    expect(screen.getByRole("textbox", { name: /search/i })).toBeVisible();
  });

  it("Confirm needs a chosen candidate and a reason of 1-280 characters", async () => {
    const user = userEvent.setup();
    setup({ [CANDIDATES]: list(guest) });
    const confirm = () => screen.getByRole("button", { name: "Confirm" });
    await user.click(await screen.findByRole("radio", { name: /Jane Doe/ }));
    expect(confirm()).toBeDisabled();
    const reason = screen.getByLabelText(/reason/i);
    await user.type(reason, "ok");
    expect(confirm()).toBeEnabled();
    await user.clear(reason);
    await user.click(reason);
    await user.paste("x".repeat(281));
    expect(confirm()).toBeDisabled();
    await user.clear(reason);
    await user.paste("x".repeat(280));
    expect(confirm()).toBeEnabled();
  });

  it("Confirm opens an AlertDialog naming the person and the team; nothing is sent before it", async () => {
    const user = userEvent.setup();
    const { api } = setup({ [CANDIDATES]: list(guest) });
    await fillAndConfirm(user);
    const alert = await screen.findByRole("alertdialog");
    expect(alert).toHaveTextContent("Jane Doe");
    expect(alert).toHaveTextContent("Payments");
    expect(api.writes()).toEqual([]);
    await user.click(within(alert).getByRole("button", { name: /cancel/i }));
    expect(api.writes()).toEqual([]);
  });

  it("the confirmed accept posts exactly { oid, reason } and reports the oid", async () => {
    const user = userEvent.setup();
    const { api, onAccepted } = setup({
      [CANDIDATES]: list(guest),
      [ACCEPT]: () => ok({ oid: "oid-jane", teamId: "team-pay" }),
    });
    await fillAndConfirm(user);
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Add to team",
      }),
    );
    await waitFor(() => expect(onAccepted).toHaveBeenCalledWith("oid-jane"));
    expect(api.writes()).toHaveLength(1);
    expect(api.writes()[0]?.body).toEqual({
      oid: "oid-jane",
      reason: "Same person, guest UPN",
    });
  });

  // T-INV3, T-INV4, T-INV6 and the matrix: 409 refusals stay inline, no change.
  it.each([
    ["CONFLICT", /reload/i],
    ["ALREADY_AFFILIATED", /move/i],
    ["MANAGED_BY_SSO", /entra/i],
    ["PRIVILEGED_TARGET", /administrator|global role|privileged|cannot be/i],
  ])(
    "a 409 %s shows an inline error, keeps the dialog and changes nothing",
    async (code, pattern) => {
      const user = userEvent.setup();
      const { onAccepted } = setup({
        [CANDIDATES]: list(guest),
        [ACCEPT]: () => fail(409, code),
      });
      await fillAndConfirm(user);
      await user.click(
        within(await screen.findByRole("alertdialog")).getByRole("button", {
          name: "Add to team",
        }),
      );
      const message = await screen.findByRole("alert");
      expect(message).toHaveTextContent(pattern);
      expect(message).not.toHaveTextContent(code);
      expect(message).not.toHaveTextContent("server text");
      expect(onAccepted).not.toHaveBeenCalled();
    },
  );

  // Q-W1 / T-INV5: a 404 (key gone, out of scope, or not a candidate) reads as
  // "no longer exists" through accessErrorMessage, never the server text.
  it("a 404 NOT_FOUND shows the no-longer-exists message inline and changes nothing", async () => {
    const user = userEvent.setup();
    const { onAccepted } = setup({
      [CANDIDATES]: list(guest),
      [ACCEPT]: () => fail(404, "NOT_FOUND"),
    });
    await fillAndConfirm(user);
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Add to team",
      }),
    );
    const message = await screen.findByRole("alert");
    expect(message).toHaveTextContent(/no longer exists/i);
    expect(message).not.toHaveTextContent("NOT_FOUND");
    expect(onAccepted).not.toHaveBeenCalled();
  });
});

// INV2: Access Control - "Placing a person by hand" (preselect only when
// exactly one candidate is exact: a UPN match or the LiteLLM link; the reason
// stays required) and T-IV2 (an unverified LiteLLM email selects no one: the
// email alone is shown, never selected).
describe("AcceptInviteDialog preselection (INV2, T-IV2)", () => {
  const linked = {
    oid: "oid-linked",
    displayName: "Linked Person",
    upn: "lp@corp.example.com",
    email: "other@example.com",
    exact: true,
    signal: "litellm-link",
  };
  const emailOnly = {
    oid: "oid-mail",
    displayName: "Mail Only",
    upn: "mo@corp.example.com",
    email: KEY,
    exact: false,
    signal: "email",
  };

  it("preselects the one exact candidate, and the reason is still required before Confirm", async () => {
    const user = userEvent.setup();
    setup({ [CANDIDATES]: list(guest, exact) });
    const radio = await screen.findByRole("radio", { name: /Jane Other/ });
    expect(radio).toBeChecked();
    expect(screen.getByRole("radio", { name: /Jane Doe/ })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
    await user.type(screen.getByLabelText(/reason/i), "Checked with the lead");
    expect(screen.getByRole("button", { name: "Confirm" })).toBeEnabled();
  });

  it("preselects the identity linked to the LiteLLM user (signal litellm-link)", async () => {
    setup({ [CANDIDATES]: list(emailOnly, linked) });
    expect(
      await screen.findByRole("radio", { name: /Linked Person/ }),
    ).toBeChecked();
    expect(screen.getByRole("radio", { name: /Mail Only/ })).not.toBeChecked();
  });

  it("never preselects an email-only candidate, even when it is the only one (T-IV2)", async () => {
    setup({ [CANDIDATES]: list(emailOnly) });
    expect(
      await screen.findByRole("radio", { name: /Mail Only/ }),
    ).not.toBeChecked();
  });

  it("preselects no one when two candidates are exact", async () => {
    setup({ [CANDIDATES]: list(exact, linked) });
    await screen.findByRole("radio", { name: /Jane Other/ });
    expect(
      screen.getAllByRole("radio").some((r) => r.matches(":checked")),
    ).toBe(false);
  });

  it("the preselected person is the one sent: the accept posts that oid (T-IV1 stays server-checked)", async () => {
    const user = userEvent.setup();
    const { api } = setup({
      [CANDIDATES]: list(guest, exact),
      [ACCEPT]: () => ok({ oid: "oid-other", teamId: "team-pay" }),
    });
    await screen.findByRole("radio", { name: /Jane Other/ });
    await user.type(screen.getByLabelText(/reason/i), "Exact UPN");
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Add to team",
      }),
    );
    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]?.body).toEqual({
      oid: "oid-other",
      reason: "Exact UPN",
    });
  });

  it("is titled 'Approve and add <key>' and shows no 'Accept invite' (INV2 label)", async () => {
    setup({ [CANDIDATES]: list(guest) });
    const dialog = await screen.findByRole("dialog", {
      name: /approve and add/i,
    });
    expect(dialog).toHaveTextContent(KEY);
    expect(screen.queryByText(/accept invite/i)).not.toBeInTheDocument();
  });
});
