import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiError, apiResponse } from "@/test/fakes/api-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { RequestBudgetReset } from "./RequestBudgetReset";

// Sources: docs/specs/2026-11-10-litellm.md -- "Budget reset requests" Flow 1
// ("Request a budget reset" beside "Request a budget increase"; an optional
// reason: plain text, at most 280 characters, rendered as text only; no
// LiteLLM call) and MG-D11 (the control is absent on an unlinked team and
// whenever requestBudgetReset or resetMemberSpend is off: "hidden, never
// dead"); Data Model -- API Routes (`/mine` eligibility reasons; the team is
// the caller's own member team, never a body field); Access Control BR6
// (one open request per person per team), BR7 (reason is text, capped).
// The route's own rules are tested with the routes; this layer tests what the
// caller sees and the request it sends. Rule 60.24a.
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const VIEW = {
  id: REQUEST_ID,
  teamId: "t1",
  teamName: "Payments",
  requester: { oid: "oid-ada", displayName: "Ada", email: "ada@example.test" },
  reason: "<script>alert(1)</script> need budget",
  status: "open",
  createdAt: "2026-11-14T09:00:00.000Z",
  requestExpiresAt: "2026-11-21T09:00:00.000Z",
  decidedAt: null,
  decidedBy: null,
};

const mine = (over: Record<string, unknown> = {}) => ({
  teamId: "t1",
  eligibility: { canRequest: true, reason: null },
  open: null,
  recent: [],
  ...over,
});

type Call = { method: string; path: string; body: unknown };
function stub(
  mineResponse: () => Response,
  create: () => Response = () => apiResponse({ data: VIEW }, 201),
) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "http://localhost").pathname;
      const method = init?.method ?? "GET";
      const body =
        typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ method, path, body });
      if (method === "GET" && path === "/api/budget-reset-requests/mine") {
        return mineResponse();
      }
      if (method === "POST" && path === "/api/budget-reset-requests") {
        return create();
      }
      throw new Error(`unexpected ${method} ${path}`);
    }),
  );
  return { calls, posts: () => calls.filter((c) => c.method === "POST") };
}

const user = () => userEvent.setup({ pointerEventsCheck: 0 });
const OPEN_BUTTON = { name: "Request a budget reset" };

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("RequestBudgetReset visibility (MG-D11: hidden, never dead)", () => {
  it("a member of a linked team with both toggles on sees the control", async () => {
    stub(() => apiResponse({ data: mine() }));
    renderWithProviders(<RequestBudgetReset />);
    expect(await screen.findByRole("button", OPEN_BUTTON)).toBeVisible();
  });

  it.each([
    ["no-team", "a viewer with no member team"],
    ["not-linked", "a team that is not linked to LiteLLM"],
    ["disabled", "requestBudgetReset or resetMemberSpend switched off"],
  ])("eligibility reason %s (%s) renders nothing", async (...[reason]) => {
    const api = stub(() =>
      apiResponse({
        data: mine({ eligibility: { canRequest: false, reason } }),
      }),
    );
    const { container } = renderWithProviders(<RequestBudgetReset />);
    await waitFor(() => expect(api.calls).toHaveLength(1));
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(screen.queryByRole("button", OPEN_BUTTON)).toBeNull();
  });

  it("a failed eligibility read renders nothing and no error (the control never breaks My usage)", async () => {
    const api = stub(() => apiError(500, "INTERNAL_ERROR", "boom"));
    const { container } = renderWithProviders(<RequestBudgetReset />);
    await waitFor(() => expect(api.calls.length).toBeGreaterThan(0));
    expect(container).toBeEmptyDOMElement();
  });

  it("while a request is open the button is replaced by a waiting notice (BR6: one open request per person per team)", async () => {
    stub(() =>
      apiResponse({
        data: mine({
          eligibility: { canRequest: false, reason: "open-request" },
          open: VIEW,
        }),
      }),
    );
    renderWithProviders(<RequestBudgetReset />);
    expect(
      await screen.findByText(/waiting for your team lead/i),
    ).toBeVisible();
    expect(screen.queryByRole("button", OPEN_BUTTON)).toBeNull();
  });

  it("the reason of the open request shows as text, never HTML (BR7)", async () => {
    stub(() =>
      apiResponse({
        data: mine({
          eligibility: { canRequest: false, reason: "open-request" },
          open: VIEW,
        }),
      }),
    );
    renderWithProviders(<RequestBudgetReset />);
    const reason = await screen.findByText(/need budget/);
    expect(reason).toHaveTextContent("<script>alert(1)</script> need budget");
    expect(document.querySelector("script")).toBeNull();
  });
});

describe("RequestBudgetReset sending (Flow 1; Data Model - API Routes)", () => {
  async function openDialog() {
    const u = user();
    await u.click(await screen.findByRole("button", OPEN_BUTTON));
    return { u, dialog: await screen.findByRole("dialog") };
  }

  it("sends POST /api/budget-reset-requests with the trimmed reason and no team field", async () => {
    const api = stub(() => apiResponse({ data: mine() }));
    renderWithProviders(<RequestBudgetReset />);
    const { u, dialog } = await openDialog();
    await u.type(within(dialog).getByLabelText(/reason/i), "  Launch week  ");
    await u.click(within(dialog).getByRole("button", { name: "Send request" }));
    await waitFor(() => expect(api.posts()).toHaveLength(1));
    expect(api.posts()[0]).toMatchObject({
      path: "/api/budget-reset-requests",
      body: { reason: "Launch week" },
    });
    expect(Object.keys(api.posts()[0]?.body as object)).toEqual(["reason"]);
  });

  it("the reason is optional: an empty reason sends an empty body", async () => {
    const api = stub(() => apiResponse({ data: mine() }));
    renderWithProviders(<RequestBudgetReset />);
    const { u, dialog } = await openDialog();
    await u.click(within(dialog).getByRole("button", { name: "Send request" }));
    await waitFor(() => expect(api.posts()).toHaveLength(1));
    expect(api.posts()[0]?.body).toEqual({});
  });

  it("the reason field stops at 280 characters (BR7)", async () => {
    stub(() => apiResponse({ data: mine() }));
    renderWithProviders(<RequestBudgetReset />);
    const { u, dialog } = await openDialog();
    const field = within(dialog).getByLabelText(/reason/i);
    await u.click(field);
    await u.paste("x".repeat(300));
    expect((field as HTMLTextAreaElement).value).toHaveLength(280);
    expect(within(dialog).getByText("280/280")).toBeVisible();
  });

  it("Cancel closes the dialog and sends nothing", async () => {
    const api = stub(() => apiResponse({ data: mine() }));
    renderWithProviders(<RequestBudgetReset />);
    const { u, dialog } = await openDialog();
    await u.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.posts()).toHaveLength(0);
  });

  it("after a successful send the dialog closes and the control shows the open request", async () => {
    let created = false;
    stub(
      () =>
        apiResponse({
          data: created
            ? mine({
                eligibility: { canRequest: false, reason: "open-request" },
                open: VIEW,
              })
            : mine(),
        }),
      () => {
        created = true;
        return apiResponse({ data: VIEW }, 201);
      },
    );
    renderWithProviders(<RequestBudgetReset />);
    const { u, dialog } = await openDialog();
    await u.click(within(dialog).getByRole("button", { name: "Send request" }));
    expect(
      await screen.findByText(/waiting for your team lead/i),
    ).toBeVisible();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", OPEN_BUTTON)).toBeNull();
  });

  it.each([
    [409, "CONFLICT", "You already have an open request"],
    [403, "OPERATION_DISABLED", "Budget reset requests are switched off"],
    [400, "BAD_REQUEST", "Reason must not contain control characters"],
  ])(
    "a %i %s answer shows the server's message in the dialog and keeps it open",
    async (status, code, message) => {
      stub(
        () => apiResponse({ data: mine() }),
        () => apiError(status, code, message),
      );
      renderWithProviders(<RequestBudgetReset />);
      const { u, dialog } = await openDialog();
      await u.click(
        within(dialog).getByRole("button", { name: "Send request" }),
      );
      expect(await within(dialog).findByRole("alert")).toHaveTextContent(
        message,
      );
      expect(screen.getByRole("dialog")).toBeVisible();
    },
  );
});
