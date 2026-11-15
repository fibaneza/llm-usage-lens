import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ORG_UNITS,
  fail,
  ok,
  page,
  stubAccessApi,
} from "@/test/access-ui-stubs";
import { renderWithProviders } from "@/test/render-providers";

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
//   <PendingAccessSection />   (read-only; the routes scope the rows)
// Reads GET /api/access/pending (PendingItem rows), GET /api/access/stale
// ({ reason: "pending" | "inactive", kind: "affiliation" | "adminScope" |
// "roleGrant", subject, displayName?, email?, teamId?, scopeType?, scopeId?,
// role?, since }) and GET /api/access/org-units for team and department names.
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
    renderWithProviders(<PendingAccessSection />);
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
    renderWithProviders(<PendingAccessSection />);
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
    renderWithProviders(<PendingAccessSection />);
    expect(await screen.findByText(/no pending invitations/i)).toBeVisible();
    expect(screen.getByText(/no stale access/i)).toBeVisible();
    expect(screen.queryByText(/couldn't load/i)).not.toBeInTheDocument();
  });

  it("is read-only: it offers no write controls", async () => {
    const api = stubAccessApi(routes());
    renderWithProviders(<PendingAccessSection />);
    await screen.findByRole("row", { name: /new\.hire@/ });
    expect(
      screen.queryByRole("button", { name: /remove|revoke|delete|add/i }),
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
    renderWithProviders(<PendingAccessSection />);
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
    renderWithProviders(<PendingAccessSection />);
    expect(
      await screen.findByRole("row", { name: /new\.hire@/ }),
    ).toBeVisible();
    expect(await screen.findByText(/couldn't load/i)).toBeVisible();
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
  });
});
