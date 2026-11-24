import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ORG_UNITS,
  fail,
  ok,
  page,
  stubAccessApi,
} from "@/test/fakes/access-ui-stubs";
import {
  ADMIN,
  AUDITOR,
  DEPT_ADMIN,
  ORG_ADMIN,
  PLAIN_VIEWER,
  TEAM_ADMIN,
} from "@/test/fixtures/access-viewers";
import { renderWithProviders } from "@/test/support/render-providers";

import { PendingAccessSection } from "./PendingAccessSection";

// Source: docs/specs/2026-11-10-access-control.md - "Membership, admin scopes
// and lifecycle" (Joiner: a pending item grants nothing until the first
// sign-in binds it; Leaver: stale = pending items not bound after 30 days, and
// affiliations, admin scopes and in-app grants whose user has not signed in for
// 90 days, decision D2), D34 reversed by the user on 2026-11-15 (the Settings
// lists are built in 4R.4), D37 (names for in-scope rows only), Design System
// - Settings Page, Rule 20.1 (UTC), Rules 40.4 / 60.12.
//
// Module under test: `components/settings/access/PendingAccessSection.tsx`
//   <PendingAccessSection viewer={ADMIN} />   (read-only; the routes scope the rows)
// Reads GET /api/access/pending (PendingItem rows), GET /api/access/stale
// ({ reason: "pending" | "inactive", kind: "affiliation" | "adminScope" |
// "roleGrant", subject, displayName?, email?, teamId?, scopeType?, scopeId?,
// role?, since }) and GET /api/access/org-units for team and department names.
// INV1 (Access Control - Accept a pending invite; permission matrix row):
// the prop `viewer: AccessViewer` decides who gets an Accept action on a pending
// member invitation for a team in their scope (canAcceptInvite).
// Two lists under h3 headings "Pending invitations" and "Stale access".
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const pending = (over: Record<string, unknown> = {}) => ({
  kind: "affiliation",
  emailOrUpn: "new.hire@example.com",
  teamId: "team-pay",
  createdBy: "oid-admin",
  createdAt: "2026-11-10T09:00:00.000Z",
  version: 1,
  ...over,
});
const staleUnbound = {
  reason: "pending",
  kind: "affiliation",
  subject: "old.hire@example.com",
  teamId: "team-risk",
  since: "2026-09-01T09:00:00.000Z",
};
const staleGrant = {
  reason: "inactive",
  kind: "roleGrant",
  subject: "oid-alice",
  displayName: "Alice Adams",
  email: "alice@example.com",
  role: "internal-org-admin",
  since: "2026-06-01T09:00:00.000Z",
};
const staleScope = {
  reason: "inactive",
  kind: "adminScope",
  subject: "oid-bob",
  displayName: "Bob Brown",
  email: "bob@example.com",
  scopeType: "department",
  scopeId: "dept-eng",
  since: "2026-05-01T09:00:00.000Z",
};

const routes = (extra: Record<string, unknown> = {}) => ({
  "GET /api/access/org-units": ORG_UNITS,
  "GET /api/access/pending": page([
    pending(),
    pending({
      kind: "adminScope",
      emailOrUpn: "lead@example.com",
      teamId: undefined,
      scopeType: "team",
      scopeId: "team-risk",
    }),
  ]),
  "GET /api/access/stale": page([staleUnbound, staleGrant, staleScope]),
  ...extra,
});

describe("PendingAccessSection", () => {
  it("lists pending invitations with the email or UPN, what they will get and the creation date (UTC)", async () => {
    stubAccessApi(routes());
    renderWithProviders(<PendingAccessSection viewer={ADMIN} />);
    const member = await screen.findByRole("row", { name: /new\.hire@/ });
    expect(member).toHaveTextContent(/Payments/);
    expect(member).toHaveTextContent(/member/i);
    expect(member).toHaveTextContent(/2026-11-10/);
    const admin = screen.getByRole("row", { name: /lead@example\.com/ });
    expect(admin).toHaveTextContent(/Risk/);
    expect(admin).toHaveTextContent(/admin/i);
  });

  it("lists stale access with the reason: unbound for 30 days, or no sign-in for 90 days", async () => {
    stubAccessApi(routes());
    renderWithProviders(<PendingAccessSection viewer={ADMIN} />);
    const unbound = await screen.findByRole("row", { name: /old\.hire@/ });
    expect(unbound).toHaveTextContent(/not bound after 30 days/i);
    expect(unbound).toHaveTextContent(/Risk/);
    expect(unbound).toHaveTextContent(/2026-09-01/);
    const grant = screen.getByRole("row", { name: /Alice Adams/ });
    expect(grant).toHaveTextContent(/no sign-in for 90 days/i);
    expect(grant).toHaveTextContent(/alice@example\.com/);
    expect(grant).toHaveTextContent(/2026-06-01/);
    const scope = screen.getByRole("row", { name: /Bob Brown/ });
    expect(scope).toHaveTextContent(/no sign-in for 90 days/i);
    expect(scope).toHaveTextContent(/Engineering/);
  });

  it("shows a neutral empty state for each list, not an error", async () => {
    stubAccessApi(
      routes({
        "GET /api/access/pending": page([]),
        "GET /api/access/stale": page([]),
      }),
    );
    renderWithProviders(<PendingAccessSection viewer={ADMIN} />);
    expect(await screen.findByText(/no pending invitations/i)).toBeVisible();
    expect(screen.getByText(/no stale access/i)).toBeVisible();
    expect(screen.queryByText(/couldn't load/i)).not.toBeInTheDocument();
  });

  // Access Control - Placing a person by hand (INV2): the accept action is
  // relabelled "Approve and add" and is the one sanctioned write here; every
  // other remove/revoke/delete/add control stays absent. No write is sent on render.
  it("offers no remove, revoke, delete or add-member controls (only Approve and add)", async () => {
    const api = stubAccessApi(routes());
    renderWithProviders(<PendingAccessSection viewer={ADMIN} />);
    await screen.findByRole("row", { name: /new\.hire@/ });
    expect(
      screen.queryByRole("button", {
        name: (name) =>
          /remove|revoke|delete|add/i.test(name) &&
          !/^approve and add/i.test(name),
      }),
    ).not.toBeInTheDocument();
    expect(api.writes()).toEqual([]);
  });

  it("loads the next page of a list through the opaque cursor", async () => {
    const user = userEvent.setup();
    const api = stubAccessApi(
      routes({
        "GET /api/access/pending": (call: { search: string }) =>
          call.search.includes("cursor=next-1")
            ? ok(page([pending({ emailOrUpn: "second.page@example.com" })]))
            : ok(page([pending()], "next-1")),
      }),
    );
    renderWithProviders(<PendingAccessSection viewer={ADMIN} />);
    await screen.findByRole("row", { name: /new\.hire@/ });
    await user.click(screen.getByRole("button", { name: /load more/i }));
    expect(
      await screen.findByRole("row", { name: /second\.page@/ }),
    ).toBeInTheDocument();
    expect(api.to("GET /api/access/pending")).toHaveLength(2);
  });

  it("a failing list shows its own alert with Retry and leaves the other list working", async () => {
    stubAccessApi(
      routes({ "GET /api/access/stale": () => fail(500, "INTERNAL") }),
    );
    renderWithProviders(<PendingAccessSection viewer={ADMIN} />);
    expect(
      await screen.findByRole("row", { name: /new\.hire@/ }),
    ).toBeVisible();
    expect(await screen.findByText(/couldn't load/i)).toBeVisible();
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
  });
});

// Source: Access Control - "Accept a pending invite" and the matrix row (unit
// INV1): admin and org-admin any team, a lead (team scope) or department
// admin for teams in scope; never for an admin-scope item; auditor and viewer
// never. Design System - Management improvements (Accept action per pending
// member invitation). INV2 (Access Control - "Placing a person by hand": the
// action "replaces the label **Accept invite**"; Design System - Members
// panel) renames the button to "Approve and add"; the callers are unchanged.
describe("PendingAccessSection - Approve and add action (INV1; INV2 label)", () => {
  const memberPay = () => pending();
  const memberRisk = () =>
    pending({ emailOrUpn: "risk.hire@example.com", teamId: "team-risk" });
  const adminScope = () =>
    pending({
      kind: "adminScope",
      emailOrUpn: "lead@example.com",
      teamId: undefined,
      scopeType: "team",
      scopeId: "team-pay",
    });
  const inv = (extra: Record<string, unknown> = {}) =>
    routes({
      "GET /api/access/pending": page([
        memberPay(),
        memberRisk(),
        adminScope(),
      ]),
      ...extra,
    });
  const accept = (key: RegExp) =>
    screen.queryByRole("button", {
      name: new RegExp(`approve and add.*${key.source}`, "i"),
    });

  it.each([
    ["internal-admin", ADMIN],
    ["internal-org-admin", ORG_ADMIN],
  ])("%s may accept a member invitation for any team", async (_n, viewer) => {
    stubAccessApi(inv());
    renderWithProviders(<PendingAccessSection viewer={viewer} />);
    await screen.findByRole("row", { name: /new\.hire@/ });
    expect(accept(/new\.hire@/)).toBeVisible();
    expect(accept(/risk\.hire@/)).toBeVisible();
  });

  it("never offers Approve and add on a pending admin-scope item (matrix: members only)", async () => {
    stubAccessApi(inv());
    renderWithProviders(<PendingAccessSection viewer={ADMIN} />);
    await screen.findByRole("row", { name: /lead@example\.com/ });
    expect(accept(/lead@/)).not.toBeInTheDocument();
    expect(
      within(
        screen.getByRole("row", { name: /lead@example\.com/ }),
      ).queryByRole("button"),
    ).not.toBeInTheDocument();
  });

  it("a team lead may accept only for a team in its scope", async () => {
    stubAccessApi(inv());
    renderWithProviders(<PendingAccessSection viewer={TEAM_ADMIN} />);
    await screen.findByRole("row", { name: /risk\.hire@/ });
    expect(accept(/new\.hire@/)).toBeVisible();
    expect(accept(/risk\.hire@/)).not.toBeInTheDocument();
  });

  it("a department admin may accept for the teams of its department only", async () => {
    stubAccessApi(inv());
    renderWithProviders(<PendingAccessSection viewer={DEPT_ADMIN} />);
    await screen.findByRole("row", { name: /risk\.hire@/ });
    expect(accept(/new\.hire@/)).toBeVisible();
    expect(accept(/risk\.hire@/)).not.toBeInTheDocument();
  });

  it.each([
    ["internal-auditor", AUDITOR],
    ["internal-viewer", PLAIN_VIEWER],
  ])("%s gets no Approve and add action", async (_n, viewer) => {
    stubAccessApi(inv());
    renderWithProviders(<PendingAccessSection viewer={viewer} />);
    await screen.findByRole("row", { name: /new\.hire@/ });
    expect(
      screen.queryByRole("button", { name: /approve and add|accept/i }),
    ).not.toBeInTheDocument();
  });

  // INV2 (Access Control - "Placing a person by hand": "It replaces the label
  // **Accept invite**"): the old label is gone everywhere in the section.
  it("labels the action 'Approve and add' and shows no 'Accept invite' label (INV2)", async () => {
    stubAccessApi(inv());
    renderWithProviders(<PendingAccessSection viewer={ADMIN} />);
    await screen.findByRole("row", { name: /new\.hire@/ });
    const button = accept(/new\.hire@/);
    expect(button).toBeVisible();
    expect(button).toHaveTextContent("Approve and add");
    expect(screen.queryByText(/accept invite/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /accept invite/i }),
    ).not.toBeInTheDocument();
  });

  it("accepting: pick the candidate, give a reason, confirm; the invite leaves the pending list (T-INV1, T-INV4)", async () => {
    const user = userEvent.setup();
    let accepted = false;
    const api = stubAccessApi(
      inv({
        "GET /api/access/pending": () =>
          ok(
            page(
              accepted
                ? [memberRisk(), adminScope()]
                : [memberPay(), memberRisk(), adminScope()],
            ),
          ),
        "GET /api/teams/team-pay/members/pending/new.hire@example.com/candidates":
          {
            items: [
              {
                oid: "oid-jane",
                displayName: "Jane Doe",
                upn: "new.hire@example.com",
                email: "new.hire@example.com",
                exact: true,
                signal: "upn",
              },
            ],
          },
        "POST /api/teams/team-pay/members/pending/new.hire@example.com/accept":
          () => {
            accepted = true;
            return ok({ oid: "oid-jane", teamId: "team-pay" });
          },
      }),
    );
    renderWithProviders(<PendingAccessSection viewer={ADMIN} />);
    await user.click(
      await screen.findByRole("button", {
        name: /approve and add.*new\.hire@/i,
      }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(
      await within(dialog).findByRole("radio", { name: /Jane Doe/ }),
    );
    await user.type(
      within(dialog).getByLabelText(/reason/i),
      "Same person, guest UPN",
    );
    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Add to team",
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("row", { name: /new\.hire@/ }),
      ).not.toBeInTheDocument(),
    );
    expect(api.writes()).toHaveLength(1);
    expect(screen.getByRole("row", { name: /risk\.hire@/ })).toBeVisible();
  });
});

// Unit TM1, D-TM3 (Design
// System - Management pages, Team, "List, then the team"): with the optional
// `teamId` prop (the route's team) the section lists that team's member
// invitations only, with their age and the stale mark; pending admin scopes,
// other teams' rows, role grants and admin-scope stale rows stay in
// Settings -> Access. Prop contract: `<PendingAccessSection viewer teamId="team-pay" />`.
describe("PendingAccessSection with a teamId prop (TM1 D-TM3)", () => {
  const staleOwn = {
    reason: "pending",
    kind: "affiliation",
    subject: "stale.hire@example.com",
    teamId: "team-pay",
    since: "2026-09-02T09:00:00.000Z",
  };
  // The route does the filtering (Design System - "List, then the team",
  // Pending and stale access: "The filter runs on the server"): this stand-in
  // answers ?teamId= with that team's member rows only.
  const serverFiltered =
    (rows: Record<string, unknown>[]) => (call: { search: string }) => {
      const id = new URLSearchParams(call.search).get("teamId");
      const shown =
        id === null
          ? rows
          : rows.filter((r) => r.kind === "affiliation" && r.teamId === id);
      return ok(page(shown));
    };
  const teamRoutes = () =>
    routes({
      "GET /api/access/pending": serverFiltered([
        pending(),
        pending({ emailOrUpn: "risk.hire@example.com", teamId: "team-risk" }),
        pending({
          kind: "adminScope",
          emailOrUpn: "lead@example.com",
          teamId: undefined,
          scopeType: "team",
          scopeId: "team-pay",
        }),
      ]),
      "GET /api/access/stale": serverFiltered([
        staleOwn,
        staleUnbound,
        staleGrant,
        staleScope,
      ]),
    });

  // Q-B3 (review r1; Design System, Pending and stale access: the filter runs
  // on the server, a browser filter over loaded pages could say "No pending
  // invitations." while the team had some on a later page).
  it("requests ?teamId= on both lists", async () => {
    const api = stubAccessApi(teamRoutes());
    renderWithProviders(
      <PendingAccessSection viewer={ADMIN} teamId="team-pay" />,
    );
    await screen.findByRole("row", { name: /new\.hire@/ });
    await screen.findByRole("row", { name: /stale\.hire@/ });
    for (const key of ["GET /api/access/pending", "GET /api/access/stale"]) {
      const searches = api.to(key).map((c) => c.search);
      expect(searches.length).toBeGreaterThan(0);
      for (const s of searches) {
        expect(new URLSearchParams(s).get("teamId")).toBe("team-pay");
      }
    }
  });

  it("does not filter in the browser: it shows the rows the route returned", async () => {
    stubAccessApi(
      routes({
        "GET /api/access/pending": page([
          pending({ emailOrUpn: "late.hire@example.com", teamId: "team-pay" }),
          pending({ emailOrUpn: "odd@example.com", teamId: "team-risk" }),
        ]),
        "GET /api/access/stale": page([]),
      }),
    );
    renderWithProviders(
      <PendingAccessSection viewer={ADMIN} teamId="team-pay" />,
    );
    await screen.findByRole("row", { name: /late\.hire@/ });
    expect(screen.getByRole("row", { name: /odd@/ })).toBeVisible();
  });

  it("Load more keeps ?teamId= beside the cursor", async () => {
    const user = userEvent.setup();
    const api = stubAccessApi(
      routes({
        "GET /api/access/pending": (call: { search: string }) =>
          new URLSearchParams(call.search).has("cursor")
            ? ok(page([pending({ emailOrUpn: "second@example.com" })]))
            : ok(page([pending()], "next-1")),
        "GET /api/access/stale": page([]),
      }),
    );
    renderWithProviders(
      <PendingAccessSection viewer={ADMIN} teamId="team-pay" />,
    );
    await screen.findByRole("row", { name: /new\.hire@/ });
    await user.click(screen.getByRole("button", { name: "Load more" }));
    await screen.findByRole("row", { name: /second@/ });
    const second = api
      .to("GET /api/access/pending")
      .map((c) => new URLSearchParams(c.search))
      .find((q) => q.has("cursor"));
    expect(second?.get("teamId")).toBe("team-pay");
    expect(second?.get("cursor")).toBe("next-1");
  });

  it("lists only that team's member invitations, with the invited date", async () => {
    stubAccessApi(teamRoutes());
    renderWithProviders(
      <PendingAccessSection viewer={ADMIN} teamId="team-pay" />,
    );
    const own = await screen.findByRole("row", { name: /new\.hire@/ });
    expect(own).toHaveTextContent(/2026-11-10/);
    expect(
      screen.queryByRole("row", { name: /risk\.hire@/ }),
    ).not.toBeInTheDocument();
  });

  // D-TM3: pending admin scopes stay in Settings -> Access.
  it("shows no pending admin-scope row, even for this team", async () => {
    stubAccessApi(teamRoutes());
    renderWithProviders(
      <PendingAccessSection viewer={ADMIN} teamId="team-pay" />,
    );
    await screen.findByRole("row", { name: /new\.hire@/ });
    expect(
      screen.queryByRole("row", { name: /lead@example\.com/ }),
    ).not.toBeInTheDocument();
  });

  // D-TM3 "with the stale mark": this team's unbound invitation shows its
  // reason and date; other teams' stale rows, role grants and admin scopes do not.
  it("lists only this team's stale member rows, with the stale reason", async () => {
    stubAccessApi(teamRoutes());
    renderWithProviders(
      <PendingAccessSection viewer={ADMIN} teamId="team-pay" />,
    );
    const stale = await screen.findByRole("row", { name: /stale\.hire@/ });
    expect(stale).toHaveTextContent(/not bound after 30 days/i);
    expect(stale).toHaveTextContent(/2026-09-02/);
    expect(screen.queryByRole("row", { name: /old\.hire@/ })).toBeNull();
    expect(screen.queryByRole("row", { name: /Alice Adams/ })).toBeNull();
    expect(screen.queryByRole("row", { name: /Bob Brown/ })).toBeNull();
  });

  // a team with no invitations shows the empty state, not other teams' rows.
  it("shows the empty states for a team that has no invitations and no stale rows", async () => {
    stubAccessApi(teamRoutes());
    renderWithProviders(
      <PendingAccessSection viewer={ADMIN} teamId="team-none" />,
    );
    expect(await screen.findByText("No pending invitations.")).toBeVisible();
    expect(await screen.findByText("No stale access.")).toBeVisible();
  });

  // Coordinator ruling: without the prop the section is unchanged
  // (covered in full by the cases above; this pins the admin-scope row).
  it("without the prop still lists the pending admin-scope row", async () => {
    stubAccessApi(teamRoutes());
    renderWithProviders(<PendingAccessSection viewer={ADMIN} />);
    expect(
      await screen.findByRole("row", { name: /lead@example\.com/ }),
    ).toBeVisible();
    expect(screen.getByRole("row", { name: /risk\.hire@/ })).toBeVisible();
  });
});
