import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiResponse } from "@/test/fakes/api-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { TeamPickerDialog } from "./TeamPickerDialog";

// Sources: Design System - Management -> Users ("Placing a person by hand",
// INV2: "Add to team opens a team picker that lists only the teams the caller
// may add members to"; the list comes from the server, so a lead sees only the
// teams in scope) and the Members panel bullet (each action "opens a confirm
// dialog naming the person and the team, with Cancel focused first"); Access
// Control - "Placing a person by hand" (Add to team: POST
// /api/teams/[id]/members { oid }; Invite: { emailOrUpn }) and T-IV6 (the
// picker is a convenience; the route still answers 403 before parsing, shown
// as an error). The route's own refusals are tested with the route.
//
// Contract (components/manage/users/TeamPickerDialog.tsx, "use client"):
//   <TeamPickerDialog
//     action={{ kind: "add"; oid: string } | { kind: "invite"; email: string }}
//     personName="Cy Young"
//     onClose={() => void}
//     onDone={() => void} />
// A role "dialog" that reads GET /api/access/org-units and lists its teams in
// a select labelled "Team"; "Continue" is disabled until a team is chosen and
// opens a role "alertdialog" naming the person and the team with Cancel
// focused first; "Confirm" sends the write; a refusal shows its message in the
// dialog and calls neither onDone nor onClose.
afterEach(() => {
  vi.unstubAllGlobals();
});

const ORG = {
  departments: [{ id: "dept-eng", name: "Engineering" }],
  teams: [
    { id: "team-pay", name: "Payments", departmentId: "dept-eng" },
    { id: "team-led", name: "Ledger", departmentId: "dept-eng" },
  ],
};

type Call = { method: string; path: string; body: unknown };

function setup(
  action: { kind: "add"; oid: string } | { kind: "invite"; email: string } = {
    kind: "add",
    oid: "oid-cy",
  },
  {
    org = ORG,
    post = () => apiResponse({ data: { ok: true } }, 201),
  }: { org?: typeof ORG; post?: () => Response } = {},
) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      const method = init?.method ?? "GET";
      calls.push({
        method,
        path: url.pathname,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (url.pathname === "/api/access/org-units") {
        return Promise.resolve(apiResponse({ data: org }));
      }
      if (method === "POST") return Promise.resolve(post());
      throw new Error(`unexpected ${method} ${url.pathname}`);
    }),
  );
  const onClose = vi.fn();
  const onDone = vi.fn();
  renderWithProviders(
    <TeamPickerDialog
      action={action}
      personName="Cy Young"
      onClose={onClose}
      onDone={onDone}
    />,
  );
  const writes = () => calls.filter((c) => c.method === "POST");
  return { calls, writes, onClose, onDone };
}

const pick = async (
  u: ReturnType<typeof userEvent.setup>,
  team = "Payments",
) => {
  const dialog = await screen.findByRole("dialog");
  const select = await within(dialog).findByRole("combobox", { name: "Team" });
  await waitFor(() =>
    expect(within(select).getByRole("option", { name: team })).toBeVisible(),
  );
  await u.selectOptions(select, team);
  return dialog;
};

describe("TeamPickerDialog (INV2, Design System - Users)", () => {
  it("lists exactly the teams the server returns for the caller (a lead's scope), nothing else", async () => {
    setup(undefined, {
      org: { ...ORG, teams: [ORG.teams[0] as (typeof ORG.teams)[number]] },
    });
    const dialog = await screen.findByRole("dialog");
    const select = await within(dialog).findByRole("combobox", {
      name: "Team",
    });
    await within(select).findByRole("option", { name: "Payments" });
    const names = within(select)
      .getAllByRole("option")
      .map((o) => o.textContent)
      .filter((t) => t && !/select/i.test(t));
    expect(names).toEqual(["Payments"]);
  });

  it("says there is no team to choose from when the list is empty", async () => {
    setup(undefined, { org: { ...ORG, teams: [] } });
    expect(await screen.findByText(/no team/i)).toBeVisible();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("Continue needs a chosen team, then confirms naming the person and the team, Cancel focused first, sending nothing yet", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0 });
    const { writes } = setup();
    const dialog = await screen.findByRole("dialog");
    expect(
      await within(dialog).findByRole("button", { name: "Continue" }),
    ).toBeDisabled();
    await pick(u);
    await u.click(screen.getByRole("button", { name: "Continue" }));
    const alert = await screen.findByRole("alertdialog");
    expect(alert).toHaveTextContent("Cy Young");
    expect(alert).toHaveTextContent("Payments");
    await waitFor(() =>
      expect(
        within(alert).getByRole("button", { name: "Cancel" }),
      ).toHaveFocus(),
    );
    expect(writes()).toEqual([]);
  });

  it("Add to team: Confirm POSTs { oid } to the chosen team's members route and reports done", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0 });
    const { writes, onDone } = setup({ kind: "add", oid: "oid-cy" });
    await pick(u, "Ledger");
    await u.click(screen.getByRole("button", { name: "Continue" }));
    await u.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Confirm",
      }),
    );
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(writes()).toEqual([
      {
        method: "POST",
        path: "/api/teams/team-led/members",
        body: { oid: "oid-cy" },
      },
    ]);
  });

  it("Invite: Confirm POSTs { emailOrUpn } to the chosen team's members route", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0 });
    const { writes, onDone } = setup({
      kind: "invite",
      email: "cy@example.com",
    });
    await pick(u);
    await u.click(screen.getByRole("button", { name: "Continue" }));
    await u.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Confirm",
      }),
    );
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(writes()).toEqual([
      {
        method: "POST",
        path: "/api/teams/team-pay/members",
        body: { emailOrUpn: "cy@example.com" },
      },
    ]);
  });

  it("a 403 from the route is shown as an error and nothing is reported done (T-IV6)", async () => {
    const u = userEvent.setup({ pointerEventsCheck: 0 });
    const { writes, onDone } = setup(undefined, {
      post: () =>
        apiResponse(
          { error: { code: "FORBIDDEN", message: "Insufficient permission" } },
          403,
        ),
    });
    await pick(u);
    await u.click(screen.getByRole("button", { name: "Continue" }));
    await u.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Confirm",
      }),
    );
    expect(await screen.findByText(/insufficient permission/i)).toBeVisible();
    expect(writes()).toHaveLength(1);
    expect(onDone).not.toHaveBeenCalled();
  });
});
