import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiError, apiResponse } from "@/test/fakes/api-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { NotificationBell } from "./NotificationBell";

// Sources: docs/specs/2026-11-10-litellm.md -- MG-D13 (a bell in the top bar
// with the unread count, `99+` above 99, and a list; a decider's notification
// carries Approve and Deny; Approve opens the AlertDialog naming the person
// and the effect; the requester is told on approved, denied and expired;
// delivery is TanStack Query polling every 60 s, paused while the tab is
// hidden; nothing in browser storage), MG-D12 (the server re-checks at the
// decision, so a refusal is the server's message), Access Control BR7 (the
// reason renders as text only) and BR8 (a notification whose request the
// caller may no longer decide shows no request details). Rules 60.21, 60.24.
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const NOTIF_ID = `2026-11-14T09:00:00.000Z#${REQUEST_ID}`;

const REQUEST = {
  id: REQUEST_ID,
  teamId: "t1",
  teamName: "Payments",
  requester: {
    oid: "oid-ada",
    displayName: "Ada Lovelace",
    email: "ada@example.test",
  },
  reason: 'Need it <img src=x onerror="alert(1)"> now',
  status: "open",
  createdAt: "2026-11-14T09:00:00.000Z",
  requestExpiresAt: "2026-11-21T09:00:00.000Z",
  decidedAt: null,
  decidedBy: null,
};

const item = (over: Record<string, unknown> = {}) => ({
  id: NOTIF_ID,
  kind: "budget-reset.requested",
  createdAt: "2026-11-14T09:00:00.000Z",
  read: false,
  teamId: "t1",
  requestId: REQUEST_ID,
  request: REQUEST,
  canDecide: true,
  ...over,
});

type Call = { method: string; path: string; body: unknown };

function stub(
  list: { items: unknown[]; unreadCount: number },
  overrides: Record<string, () => Response> = {},
) {
  const calls: Call[] = [];
  const routes: Record<string, () => Response> = {
    "GET /api/notifications": () => apiResponse({ data: list }),
    "POST /api/notifications/read": () => apiResponse({ data: { updated: 1 } }),
    ...overrides,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "http://localhost").pathname;
      const method = init?.method ?? "GET";
      const body =
        typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ method, path, body });
      const route = routes[`${method} ${path}`];
      if (!route) throw new Error(`unexpected ${method} ${path}`);
      return route();
    }),
  );
  const writes = () => calls.filter((c) => c.method !== "GET");
  const lists = () =>
    calls.filter((c) => c.method === "GET" && c.path === "/api/notifications")
      .length;
  return { calls, writes, lists };
}

const user = () => userEvent.setup({ pointerEventsCheck: 0 });
const bell = (unread: number) =>
  screen.findByRole("button", { name: `Notifications, ${unread} unread` });

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("NotificationBell unread count (MG-D13)", () => {
  it("shows the unread count on the bell", async () => {
    stub({ items: [item()], unreadCount: 3 });
    renderWithProviders(<NotificationBell />);
    expect(await bell(3)).toHaveTextContent("3");
  });

  it("shows no badge when nothing is unread", async () => {
    stub({ items: [], unreadCount: 0 });
    renderWithProviders(<NotificationBell />);
    expect(await bell(0)).not.toHaveTextContent(/\d/);
  });

  it.each([
    [99, "99"],
    [100, "99+"],
    [250, "99+"],
  ])("%i unread shows %s (boundary)", async (count, shown) => {
    stub({ items: [], unreadCount: count });
    renderWithProviders(<NotificationBell />);
    expect(await bell(count)).toHaveTextContent(shown);
  });

  it("an empty list says so", async () => {
    stub({ items: [], unreadCount: 0 });
    renderWithProviders(<NotificationBell />);
    await user().click(await bell(0));
    expect(await screen.findByText("No notifications yet.")).toBeVisible();
  });
});

describe("NotificationBell list (MG-D13, BR7, BR8)", () => {
  it("a decider sees who asked, the team's request and the reason as plain text, never as HTML (BR7)", async () => {
    stub({ items: [item()], unreadCount: 1 });
    renderWithProviders(<NotificationBell />);
    await user().click(await bell(1));
    const popover = await screen.findByText(/Budget reset requested by/);
    expect(popover).toHaveTextContent("Ada Lovelace");
    const reason = screen.getByText(/Need it/);
    expect(reason).toHaveTextContent('<img src=x onerror="alert(1)">');
    expect(reason.querySelector("img")).toBeNull();
    expect(document.querySelector("img")).toBeNull();
  });

  it("Approve and Deny show only while the server says the caller can still decide", async () => {
    stub({
      items: [
        item({ canDecide: false, request: { ...REQUEST, status: "approved" } }),
      ],
      unreadCount: 1,
    });
    renderWithProviders(<NotificationBell />);
    await user().click(await bell(1));
    await screen.findByText(/Budget reset requested by/);
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Deny" })).toBeNull();
  });

  it("after the caller lost access the notification shows no name, email, reason or buttons (BR8)", async () => {
    stub({
      items: [item({ request: null, canDecide: false })],
      unreadCount: 1,
    });
    renderWithProviders(<NotificationBell />);
    await user().click(await bell(1));
    expect(
      await screen.findByText("You no longer have access to this request."),
    ).toBeVisible();
    const text = document.body.textContent ?? "";
    for (const secret of ["Ada Lovelace", "ada@example.test", "Need it"]) {
      expect(text).not.toContain(secret);
    }
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Deny" })).toBeNull();
  });

  it.each([
    ["budget-reset.approved", "Your budget reset was approved"],
    ["budget-reset.denied", "Your budget reset was denied"],
    ["budget-reset.expired", "Your budget reset request expired"],
  ])(
    "the requester is told about the result: %s (MG-D13)",
    async (kind, headline) => {
      stub({
        items: [item({ kind, canDecide: false })],
        unreadCount: 1,
      });
      renderWithProviders(<NotificationBell />);
      await user().click(await bell(1));
      expect(await screen.findByText(headline)).toBeVisible();
      expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    },
  );
});

describe("NotificationBell reading (MG-D13: own state)", () => {
  it("opening the list marks the unread items read by id", async () => {
    const api = stub({ items: [item()], unreadCount: 1 });
    renderWithProviders(<NotificationBell />);
    await user().click(await bell(1));
    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]).toMatchObject({
      method: "POST",
      path: "/api/notifications/read",
      body: { ids: [NOTIF_ID] },
    });
  });

  it("at most 50 ids go in one mark-read call (MarkNotificationsReadInputSchema: 1..50)", async () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      item({
        id: `2026-11-14T09:00:00.${String(i).padStart(3, "0")}Z#${REQUEST_ID}`,
      }),
    );
    const api = stub({ items: many, unreadCount: 60 });
    renderWithProviders(<NotificationBell />);
    await user().click(await bell(60));
    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect((api.writes()[0]?.body as { ids: string[] }).ids).toHaveLength(50);
  });

  it("an already read list sends no mark-read call", async () => {
    const api = stub({ items: [item({ read: true })], unreadCount: 0 });
    renderWithProviders(<NotificationBell />);
    await user().click(await bell(0));
    await screen.findByText(/Budget reset requested by/);
    expect(api.writes()).toHaveLength(0);
  });

  it("keeps nothing in browser storage (Design System - Caching Strategy; MG-D13)", async () => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    stub({ items: [item()], unreadCount: 1 });
    renderWithProviders(<NotificationBell />);
    await user().click(await bell(1));
    await screen.findByText(/Budget reset requested by/);
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
});

describe("NotificationBell decisions from the list (MG-D12, MG-D13)", () => {
  it("Approve opens the AlertDialog naming the person, the team and the effect; confirming posts the approval and reads the list again", async () => {
    const api = stub(
      { items: [item({ read: true })], unreadCount: 0 },
      {
        [`POST /api/budget-reset-requests/${REQUEST_ID}/approve`]: () =>
          apiResponse({
            data: {
              request: { ...REQUEST, status: "approved" },
              resetId: "22222222-2222-4222-8222-222222222222",
              amount: 12.5,
            },
          }),
      },
    );
    const u = user();
    renderWithProviders(<NotificationBell />);
    await u.click(await bell(0));
    await u.click(await screen.findByRole("button", { name: "Approve" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(
      "Reset Ada Lovelace's spend in Payments to $0. They can spend again at once.",
    );
    expect(api.writes()).toHaveLength(0);
    const before = api.lists();
    await u.click(within(dialog).getByRole("button", { name: /approve/i }));
    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]).toMatchObject({
      method: "POST",
      path: `/api/budget-reset-requests/${REQUEST_ID}/approve`,
    });
    expect(api.writes()[0]?.body).toBeUndefined();
    await waitFor(() => expect(api.lists()).toBeGreaterThan(before));
  });

  it("Cancel in the dialog sends nothing", async () => {
    const api = stub({ items: [item({ read: true })], unreadCount: 0 });
    const u = user();
    renderWithProviders(<NotificationBell />);
    await u.click(await bell(0));
    await u.click(await screen.findByRole("button", { name: "Approve" }));
    const dialog = await screen.findByRole("alertdialog");
    await u.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(api.writes()).toHaveLength(0);
  });

  it("Deny posts the denial", async () => {
    const api = stub(
      { items: [item({ read: true })], unreadCount: 0 },
      {
        [`POST /api/budget-reset-requests/${REQUEST_ID}/deny`]: () =>
          apiResponse({ data: { request: { ...REQUEST, status: "denied" } } }),
      },
    );
    const u = user();
    renderWithProviders(<NotificationBell />);
    await u.click(await bell(0));
    await u.click(await screen.findByRole("button", { name: "Deny" }));
    const dialog = await screen.findByRole("alertdialog");
    await u.click(within(dialog).getByRole("button", { name: /deny/i }));
    await waitFor(() => expect(api.writes()).toHaveLength(1));
    expect(api.writes()[0]).toMatchObject({
      method: "POST",
      path: `/api/budget-reset-requests/${REQUEST_ID}/deny`,
    });
  });

  it.each([
    [403, "FORBIDDEN", "You cannot decide this request"],
    [409, "CONFLICT", "This request was already decided"],
    [503, "LITELLM_UNAVAILABLE", "LiteLLM is unavailable"],
  ])(
    "a %i %s refusal shows the server's message in the dialog and changes nothing on screen (BR3, BR4, BR9)",
    async (status, code, message) => {
      stub(
        { items: [item({ read: true })], unreadCount: 0 },
        {
          [`POST /api/budget-reset-requests/${REQUEST_ID}/approve`]: () =>
            apiError(status, code, message),
        },
      );
      const u = user();
      renderWithProviders(<NotificationBell />);
      await u.click(await bell(0));
      await u.click(await screen.findByRole("button", { name: "Approve" }));
      const dialog = await screen.findByRole("alertdialog");
      await u.click(within(dialog).getByRole("button", { name: /approve/i }));
      expect(await within(dialog).findByRole("alert")).toHaveTextContent(
        message,
      );
    },
  );
});

describe("NotificationBell polling (MG-D13: every 60 s, paused while the tab is hidden)", () => {
  const setHidden = (hidden: boolean) => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue(
      hidden ? "hidden" : "visible",
    );
    vi.spyOn(document, "hidden", "get").mockReturnValue(hidden);
  };

  it("reads the list again after 60 seconds, not before", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const api = stub({ items: [], unreadCount: 0 });
    renderWithProviders(<NotificationBell />);
    await vi.advanceTimersByTimeAsync(1);
    expect(api.lists()).toBe(1);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(api.lists()).toBe(1);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(api.lists()).toBe(2);
  });

  it("does not poll in the background while the tab is hidden", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const api = stub({ items: [], unreadCount: 0 });
    setHidden(true);
    renderWithProviders(<NotificationBell />);
    await vi.advanceTimersByTimeAsync(1);
    const first = api.lists();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(api.lists()).toBe(first);
  });
});
