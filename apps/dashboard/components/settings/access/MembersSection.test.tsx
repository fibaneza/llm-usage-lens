import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BOB,
  ORG_ROUTES,
  ORG_UNITS,
  UNUSED_TEAM,
  fail,
  memberItem,
  ok,
  page,
  stubAccessApi,
} from "@/test/access-ui-stubs";
import { ADMIN, TEAM_ADMIN } from "@/test/access-viewers";
import { renderWithProviders } from "@/test/render-providers";

import { MembersSection } from "./MembersSection";

// Source: docs/specs/2026-11-10-access-control.md - "Membership, admin scopes
// and lifecycle" (member: at most one team; Joiner: a work email becomes a
// pending item bound at first sign-in; Mover: atomic move, needs authority
// over both teams), "Permission matrix" (a team-scope admin may add and remove
// but not move), "Identity, SSO mapping and defaults" (SSO-sourced rows are
// read-only: "Managed in Entra"), "API routes (additions)" (/api/teams/[id]/
// members GET POST, .../[oid] DELETE {version}, /api/affiliations/[oid]/move).
// Design System - Settings Page. Rule 60.24: fetch stubbed.
//
// Module under test: `components/settings/access/MembersSection.tsx`
//   <MembersSection viewer={AccessViewer} />   (client component)
// - A native <select> labelled "Team" (options: team names from GET
//   /api/access/org-units - F10, the registry, not usage), first team
//   preselected.
// - Names come from the row itself (displayName + email, null when unknown -
//   F11), falling back to the oid; a scoped admin cannot read /api/identities.
// - Rows are table rows; icon buttons are labelled "Remove <name>" and
//   "Move <name>".
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const MEMBERS_URL = "GET /api/teams/team-pay/members";

function routes(extra: Record<string, unknown> = {}) {
  return {
    ...ORG_ROUTES,
    [MEMBERS_URL]: page([
      memberItem(),
      memberItem({ oid: "oid-bob", source: "sso", version: 5 }),
    ]),
    "GET /api/teams/team-risk/members": page([]),
    ...extra,
  };
}

describe("MembersSection", () => {
  // D37: the picker lists the account registry
  // scoped to the caller, so a team with no recent usage is selectable.
  it("takes its teams from /api/access/org-units, including a team with no usage, and never from /api/teams", async () => {
    const user = userEvent.setup();
    const api = stubAccessApi(
      routes({
        "GET /api/access/org-units": {
          ...ORG_UNITS,
          teams: [...ORG_UNITS.teams, UNUSED_TEAM],
        },
        "GET /api/teams/team-new/members": page([]),
      }),
    );
    renderWithProviders(<MembersSection viewer={ADMIN} />);
    await screen.findByRole("row", { name: /Alice Adams/ });
    const select = screen.getByLabelText("Team");
    expect(
      within(select).getByRole("option", { name: "Treasury" }),
    ).toBeInTheDocument();
    await user.selectOptions(select, "Treasury");
    expect(await screen.findByText(/no members/i)).toBeInTheDocument();
    expect(api.to("GET /api/teams")).toEqual([]);
  });

  // D37: a scoped admin cannot read the people
  // directory, so the row's own displayName and email are shown.
  it("shows the name with the email from the row when /api/identities is refused, and the oid when the row has no name", async () => {
    stubAccessApi(
      routes({
        "GET /api/identities": () => fail(403, "FORBIDDEN"),
        [MEMBERS_URL]: page([
          memberItem(),
          memberItem({ oid: "oid-ghost", version: 1 }),
        ]),
      }),
    );
    renderWithProviders(<MembersSection viewer={TEAM_ADMIN} />);
    const alice = await screen.findByRole("row", { name: /Alice Adams/ });
    expect(within(alice).getByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /oid-ghost/ })).toBeInTheDocument();
  });

  it("lists the first team's members by name, with the source of each", async () => {
    stubAccessApi(routes());
    renderWithProviders(<MembersSection viewer={ADMIN} />);
    const alice = await screen.findByRole("row", { name: /Alice Adams/ });
    expect(within(alice).getByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByLabelText("Team")).toHaveDisplayValue("Payments");
    expect(screen.getByRole("row", { name: /Bob Brown/ })).toBeInTheDocument();
  });

  it("marks an SSO-sourced member 'Managed in Entra' and offers no Remove or Move for it", async () => {
    stubAccessApi(routes());
    renderWithProviders(<MembersSection viewer={ADMIN} />);
    const bob = await screen.findByRole("row", { name: /Bob Brown/ });
    expect(within(bob).getByText(/managed in entra/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Remove Bob Brown" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Move Bob Brown" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove Alice Adams" }),
    ).toBeInTheDocument();
  });

  it("shows an empty state for a team with no members and loads another team on change", async () => {
    const user = userEvent.setup();
    const api = stubAccessApi(routes());
    renderWithProviders(<MembersSection viewer={ADMIN} />);
    await screen.findByRole("row", { name: /Alice Adams/ });
    await user.selectOptions(screen.getByLabelText("Team"), "Risk");
    expect(await screen.findByText(/no members/i)).toBeInTheDocument();
    expect(api.to("GET /api/teams/team-risk/members")).toHaveLength(1);
  });

  it("shows a 'no teams' state when there is no team to manage", async () => {
    stubAccessApi(
      routes({
        "GET /api/access/org-units": { ...ORG_UNITS, teams: [] },
      }),
    );
    renderWithProviders(<MembersSection viewer={ADMIN} />);
    expect(await screen.findByText(/no teams/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /add member/i }),
    ).not.toBeInTheDocument();
  });

  it("adds a pending member by work email and says they are bound at first sign-in", async () => {
    const user = userEvent.setup();
    const api = stubAccessApi(
      routes({
        "POST /api/teams/team-pay/members": () =>
          ok(
            {
              kind: "affiliation",
              emailOrUpn: "dana@example.com",
              teamId: "team-pay",
              createdBy: "oid-admin",
              createdAt: "2026-11-15T00:00:00.000Z",
              version: 1,
            },
            201,
          ),
      }),
    );
    renderWithProviders(<MembersSection viewer={ADMIN} />);
    await screen.findByRole("row", { name: /Alice Adams/ });
    await user.type(
      screen.getByLabelText(/work email or upn/i),
      "dana@example.com",
    );
    await user.click(screen.getByRole("button", { name: /add member/i }));
    expect(
      await screen.findByText(/dana@example\.com.*(pending|first sign-in)/is),
    ).toBeInTheDocument();
    expect(api.writes()).toEqual([
      expect.objectContaining({
        method: "POST",
        path: "/api/teams/team-pay/members",
        body: { emailOrUpn: "dana@example.com" },
      }),
    ]);
    expect(api.to(MEMBERS_URL).length).toBeGreaterThan(1);
  });

  it("submits the add form with Enter (keyboard reachable)", async () => {
    const user = userEvent.setup();
    const api = stubAccessApi(
      routes({
        "POST /api/teams/team-pay/members": () =>
          ok(
            {
              kind: "affiliation",
              emailOrUpn: "dana@example.com",
              teamId: "team-pay",
              createdBy: "x",
              createdAt: "2026-11-15T00:00:00.000Z",
              version: 1,
            },
            201,
          ),
      }),
    );
    renderWithProviders(<MembersSection viewer={ADMIN} />);
    await screen.findByRole("row", { name: /Alice Adams/ });
    await user.type(
      screen.getByLabelText(/work email or upn/i),
      "dana@example.com{Enter}",
    );
    await screen.findByText(/dana@example\.com/);
    expect(api.writes()).toHaveLength(1);
  });

  it("rejects an invalid email inline without sending a request", async () => {
    const user = userEvent.setup();
    const api = stubAccessApi(routes());
    renderWithProviders(<MembersSection viewer={ADMIN} />);
    await screen.findByRole("row", { name: /Alice Adams/ });
    const field = screen.getByLabelText(/work email or upn/i);
    await user.type(field, "not-an-email");
    await user.click(screen.getByRole("button", { name: /add member/i }));
    expect(await screen.findByText(/valid email/i)).toBeInTheDocument();
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(api.writes()).toEqual([]);
  });

  it("maps 409 ALREADY_AFFILIATED to a message that points at Move", async () => {
    const user = userEvent.setup();
    stubAccessApi(
      routes({
        "POST /api/teams/team-pay/members": () =>
          fail(409, "ALREADY_AFFILIATED"),
      }),
    );
    renderWithProviders(<MembersSection viewer={ADMIN} />);
    await screen.findByRole("row", { name: /Alice Adams/ });
    await user.type(
      screen.getByLabelText(/work email or upn/i),
      "dana@example.com",
    );
    await user.click(screen.getByRole("button", { name: /add member/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/move/i);
  });

  it("removes a member only after confirming, sending the item's version", async () => {
    const user = userEvent.setup();
    const api = stubAccessApi(
      routes({
        "DELETE /api/teams/team-pay/members/oid-alice": () =>
          ok({ oid: "oid-alice", teamId: "team-pay" }),
      }),
    );
    renderWithProviders(<MembersSection viewer={ADMIN} />);
    await user.click(
      await screen.findByRole("button", { name: "Remove Alice Adams" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Alice Adams");
    expect(api.writes()).toEqual([]);
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));
    await vi.waitFor(() =>
      expect(api.writes()).toEqual([
        expect.objectContaining({
          method: "DELETE",
          path: "/api/teams/team-pay/members/oid-alice",
          body: { version: 2 },
        }),
      ]),
    );
  });

  it("Cancel on the remove dialog sends nothing", async () => {
    const user = userEvent.setup();
    const api = stubAccessApi(routes());
    renderWithProviders(<MembersSection viewer={ADMIN} />);
    await user.click(
      await screen.findByRole("button", { name: "Remove Alice Adams" }),
    );
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Cancel",
      }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.writes()).toEqual([]);
  });

  it("shows the reload message on a stale-version conflict while removing", async () => {
    const user = userEvent.setup();
    stubAccessApi(
      routes({
        "DELETE /api/teams/team-pay/members/oid-alice": () =>
          fail(409, "CONFLICT"),
      }),
    );
    renderWithProviders(<MembersSection viewer={ADMIN} />);
    await user.click(
      await screen.findByRole("button", { name: "Remove Alice Adams" }),
    );
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Remove",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(/reload/i);
  });

  it("moves a member to another team with the version and the source team", async () => {
    const user = userEvent.setup();
    const api = stubAccessApi(
      routes({
        "POST /api/affiliations/oid-alice/move": () =>
          ok(memberItem({ teamId: "team-risk", version: 3 })),
      }),
    );
    renderWithProviders(<MembersSection viewer={ADMIN} />);
    await user.click(
      await screen.findByRole("button", { name: "Move Alice Adams" }),
    );
    const dialog = await screen.findByRole("dialog");
    const destination = within(dialog).getByLabelText("Destination team");
    expect(
      within(destination).queryByRole("option", { name: "Payments" }),
    ).not.toBeInTheDocument();
    await user.selectOptions(destination, "Risk");
    await user.click(within(dialog).getByRole("button", { name: "Move" }));
    await vi.waitFor(() =>
      expect(api.writes()).toEqual([
        expect.objectContaining({
          method: "POST",
          path: "/api/affiliations/oid-alice/move",
          body: { fromTeamId: "team-pay", toTeamId: "team-risk", version: 2 },
        }),
      ]),
    );
  });

  it("a team-scope admin can add and remove but is not offered Move", async () => {
    stubAccessApi(routes());
    renderWithProviders(<MembersSection viewer={TEAM_ADMIN} />);
    await screen.findByRole("row", { name: /Alice Adams/ });
    expect(
      screen.getByRole("button", { name: "Remove Alice Adams" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /add member/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Move Alice Adams" }),
    ).not.toBeInTheDocument();
  });

  it("falls back to the oid when the identity is unknown", async () => {
    stubAccessApi(
      routes({
        "GET /api/identities": page([BOB]),
        [MEMBERS_URL]: page([memberItem({ oid: "oid-ghost" })]),
      }),
    );
    renderWithProviders(<MembersSection viewer={ADMIN} />);
    expect(
      await screen.findByRole("row", { name: /oid-ghost/ }),
    ).toBeInTheDocument();
  });
});
