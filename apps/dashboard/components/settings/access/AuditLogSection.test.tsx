import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ALICE,
  auditItem,
  ok,
  page,
  stubAccessApi,
} from "@/test/access-ui-stubs";
import { renderWithProviders } from "@/test/render-providers";

import { AuditLogSection } from "./AuditLogSection";

// Source: docs/specs/2026-11-10-access-control.md - "Audit log" (schema: actor
// oid or `system`, action, target (omitted only on `denied`), result success |
// failed | denied, category security | change, timestamp UTC; `denied`
// records carry the refusal `code`; audit-log views are themselves audited;
// before/after hold no secrets and are not displayed here), "API routes
// (additions)" (/api/audit GET internal-admin or internal-auditor), Rule 20.1
// (UTC), the committed route (app/api/audit.integration.test.ts: `?day=YYYY-
// MM-DD` default today UTC, oldest first, `{ items, cursor? }`, opaque cursor).
// Design System - Settings Page ("Audit log ... for internal-admin and
// internal-auditor"). Rule 60.24: time is controlled with fake timers.
//
// Module under test: `components/settings/access/AuditLogSection.tsx`
//   <AuditLogSection />   (read-only for every role that sees it)
// - Date input labelled "Day" (type="date"), default today's UTC day.
// - Table: time (UTC), actor, action, target, result badge (Success / Failed /
//   Denied) and a "Security" badge for category security.
// - "Load more" button while the page has a cursor.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-15T12:00:00Z") });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const ROWS = [
  auditItem(),
  auditItem({
    action: "role.grant",
    category: "security",
    target: { type: "role", id: "oid-bob" },
    requestId: "req-2",
    timestamp: "2026-11-15T10:05:00.000Z",
  }),
  auditItem({
    action: "visibility.update",
    result: "denied",
    code: "FORBIDDEN",
    target: undefined as never,
    category: "security",
    actor: "oid-alice",
    requestId: "req-3",
    timestamp: "2026-11-15T10:06:00.000Z",
  }),
];

describe("AuditLogSection", () => {
  it("requests today's UTC day by default and lists the records oldest first", async () => {
    const api = stubAccessApi({
      "GET /api/audit": page(ROWS),
      "GET /api/identities": page([ALICE]),
    });
    renderWithProviders(<AuditLogSection />);
    const rows = await screen.findAllByRole("row");
    expect(api.to("GET /api/audit")[0]?.search).toContain("day=2026-11-15");
    expect(screen.getByLabelText("Day")).toHaveValue("2026-11-15");
    const body = rows.slice(1).map((r) => r.textContent ?? "");
    expect(body[0]).toMatch(/affiliation\.add/);
    expect(body[1]).toMatch(/role\.grant/);
    expect(body[2]).toMatch(/visibility\.update/);
  });

  it("shows the time in UTC, the result and the security category", async () => {
    stubAccessApi({ "GET /api/audit": page(ROWS) });
    renderWithProviders(<AuditLogSection />);
    const grant = await screen.findByRole("row", { name: /role\.grant/ });
    expect(within(grant).getByText(/10:05/)).toBeInTheDocument();
    expect(within(grant).getByText("Success")).toBeInTheDocument();
    expect(within(grant).getByText("Security")).toBeInTheDocument();
    const denied = screen.getByRole("row", { name: /visibility\.update/ });
    expect(within(denied).getByText("Denied")).toBeInTheDocument();
    expect(within(denied).getByText(/FORBIDDEN|forbidden/)).toBeInTheDocument();
  });

  it("renders a denied record that has no target without crashing", async () => {
    stubAccessApi({ "GET /api/audit": page([ROWS[2]]) });
    renderWithProviders(<AuditLogSection />);
    expect(
      await screen.findByRole("row", { name: /visibility\.update/ }),
    ).toBeInTheDocument();
  });

  it("shows an empty state naming the day", async () => {
    stubAccessApi({ "GET /api/audit": page([]) });
    renderWithProviders(<AuditLogSection />);
    expect(
      await screen.findByText(/no audit records.*2026-11-15/is),
    ).toBeVisible();
  });

  it("refetches for another day", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const api = stubAccessApi({ "GET /api/audit": page(ROWS) });
    renderWithProviders(<AuditLogSection />);
    await screen.findByRole("row", { name: /role\.grant/ });
    const day = screen.getByLabelText("Day");
    await user.clear(day);
    await user.type(day, "2026-11-10");
    await vi.waitFor(() =>
      expect(
        api
          .to("GET /api/audit")
          .some((c) => c.search.includes("day=2026-11-10")),
      ).toBe(true),
    );
  });

  it("pages with the opaque cursor via Load more", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const api = stubAccessApi({
      "GET /api/audit": (call: { search: string }) =>
        call.search.includes("cursor=c1")
          ? ok(
              page([
                auditItem({ action: "affiliation.remove", requestId: "req-9" }),
              ]),
            )
          : ok(page([ROWS[0]], "c1")),
    });
    renderWithProviders(<AuditLogSection />);
    await screen.findByRole("row", { name: /affiliation\.add/ });
    await user.click(screen.getByRole("button", { name: /load more/i }));
    expect(
      await screen.findByRole("row", { name: /affiliation\.remove/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("row", { name: /affiliation\.add/ }),
    ).toBeInTheDocument();
    expect(
      api.to("GET /api/audit").some((c) => c.search.includes("cursor=c1")),
    ).toBe(true);
  });

  it("hides Load more on the last page", async () => {
    stubAccessApi({ "GET /api/audit": page(ROWS) });
    renderWithProviders(<AuditLogSection />);
    await screen.findByRole("row", { name: /role\.grant/ });
    expect(
      screen.queryByRole("button", { name: /load more/i }),
    ).not.toBeInTheDocument();
  });

  it("offers no write controls", async () => {
    stubAccessApi({ "GET /api/audit": page(ROWS) });
    renderWithProviders(<AuditLogSection />);
    await screen.findByRole("row", { name: /role\.grant/ });
    expect(
      screen.queryByRole("button", { name: /delete|edit|remove|add/i }),
    ).not.toBeInTheDocument();
  });
});
