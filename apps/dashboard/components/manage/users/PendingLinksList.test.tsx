import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiResponse } from "@/test/fakes/api-stubs";
import { renderWithProviders } from "@/test/support/render-providers";

import { PendingLinksList } from "./PendingLinksList";

// Source: Design System - "Sync from LiteLLM" (People known only from LiteLLM
// are listed in their own panel, "Not signed in yet", under the People table,
// read from GET /api/identities/pending-links, with their email and LiteLLM
// user id; admin and org-admin can Remove one; they are not rows of the People
// table; the per-person actions Invite and Add user are unit INV2) and Access
// Control - API routes (additions): GET 25 rows a page with an opaque cursor,
// DELETE { email, version }; Permission matrix (the auditor reads, only admin
// and org-admin remove). The route's own cases are in its route test
// (Rule 60.24a).
//
// Contract (components/manage/users/PendingLinksList.tsx):
//   <PendingLinksList canRemove={boolean} />
// A Panel (region) named "Not signed in yet". GET data is
// { items: { email, litellmUserId, version, createdAt }[], cursor? }. Each row
// shows the email and the LiteLLM user id; Remove is a button named
// "Remove <email>" that sends DELETE { email, version } and then reloads the
// list. "Show more" sends the cursor.
const item = (n: number) => ({
  email: `p${String(n).padStart(2, "0")}@example.com`,
  litellmUserId: `lu-${n}`,
  version: 1,
  createdAt: "2026-11-20T10:00:00.000Z",
});

type Call = { method: string; url: URL; body: unknown };

function stub(
  pages: Array<{ items: unknown[]; cursor?: string }>,
  del: Response | null = null,
) {
  const calls: Call[] = [];
  let gets = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      const method = init?.method ?? "GET";
      calls.push({
        method,
        url,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (method === "DELETE") {
        return Promise.resolve(
          del ?? apiResponse({ data: { email: "p01@example.com" } }),
        );
      }
      const page = pages[Math.min(gets, pages.length - 1)];
      gets += 1;
      return Promise.resolve(apiResponse({ data: page }));
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const region = () => screen.findByRole("region", { name: "Not signed in yet" });

describe("PendingLinksList (Design System - Sync from LiteLLM)", () => {
  it("lists each person with email and LiteLLM user id in a panel of its own, reading the pending-links route", async () => {
    const calls = stub([{ items: [item(1), item(2)] }]);
    renderWithProviders(<PendingLinksList canRemove />);
    const panel = await region();
    expect(
      await within(panel).findByText("p01@example.com"),
    ).toBeInTheDocument();
    expect(within(panel).getByText("lu-1")).toBeInTheDocument();
    expect(within(panel).getByText("p02@example.com")).toBeInTheDocument();
    expect(calls[0]?.url.pathname).toBe("/api/identities/pending-links");
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("says nobody is waiting when there are no pending people (empty state)", async () => {
    stub([{ items: [] }]);
    renderWithProviders(<PendingLinksList canRemove />);
    const panel = await region();
    expect(
      await within(panel).findByText(/nobody|no one/i),
    ).toBeInTheDocument();
    expect(within(panel).queryAllByRole("listitem")).toHaveLength(0);
  });

  it("pages with Show more, sending the opaque cursor", async () => {
    const calls = stub([
      {
        items: Array.from({ length: 25 }, (_v, i) => item(i)),
        cursor: "CUR1",
      },
      { items: [item(25)] },
    ]);
    renderWithProviders(<PendingLinksList canRemove={false} />);
    const panel = await region();
    await within(panel).findByText("p00@example.com");
    await userEvent.click(
      within(panel).getByRole("button", { name: /show more/i }),
    );
    expect(
      await within(panel).findByText("p25@example.com"),
    ).toBeInTheDocument();
    expect(within(panel).getByText("p00@example.com")).toBeInTheDocument();
    expect(calls[1]?.url.searchParams.get("cursor")).toBe("CUR1");
    expect(
      within(panel).queryByRole("button", { name: /show more/i }),
    ).toBeNull();
  });

  it("an admin's Remove sends DELETE { email, version } and reloads the list without the person", async () => {
    const calls = stub([{ items: [item(1), item(2)] }, { items: [item(2)] }]);
    renderWithProviders(<PendingLinksList canRemove />);
    const panel = await region();
    await within(panel).findByText("p01@example.com");
    await userEvent.click(
      within(panel).getByRole("button", { name: "Remove p01@example.com" }),
    );
    await waitFor(() =>
      expect(within(panel).queryByText("p01@example.com")).toBeNull(),
    );
    const del = calls.find((c) => c.method === "DELETE");
    expect(del?.url.pathname).toBe("/api/identities/pending-links");
    expect(del?.body).toEqual({ email: "p01@example.com", version: 1 });
    expect(within(panel).getByText("p02@example.com")).toBeInTheDocument();
  });

  it("a refused Remove (stale version) shows the error and keeps the person", async () => {
    stub(
      [{ items: [item(1)] }],
      apiResponse(
        { error: { code: "CONFLICT", message: "Changed, reload" } },
        409,
      ),
    );
    renderWithProviders(<PendingLinksList canRemove />);
    const panel = await region();
    await within(panel).findByText("p01@example.com");
    await userEvent.click(
      within(panel).getByRole("button", { name: "Remove p01@example.com" }),
    );
    expect(await within(panel).findByRole("alert")).toHaveTextContent(
      "Changed, reload",
    );
    expect(within(panel).getByText("p01@example.com")).toBeInTheDocument();
  });

  it("the auditor reads: the rows show and no Remove button is offered (Permission matrix)", async () => {
    stub([{ items: [item(1)] }]);
    renderWithProviders(<PendingLinksList canRemove={false} />);
    const panel = await region();
    await within(panel).findByText("p01@example.com");
    expect(within(panel).queryByRole("button", { name: /remove/i })).toBeNull();
  });

  // S20 (Access Control — LiteLLM user sync): sso_user_id is compared
  // server-side only, never returned, logged or shown. The panel parses with
  // the shared strict schema (Rule 10.4), so a payload carrying the key fails
  // the parse: the panel shows its error state, renders no row data, and
  // neither the SSO value nor the field name reaches the rendered document.
  it("never shows an SSO reference: a payload carrying one fails the strict parse and renders no row (S20)", async () => {
    stub([{ items: [{ ...item(1), sso_user_id: "SSO-SENTINEL-9" }] }]);
    renderWithProviders(<PendingLinksList canRemove />);
    const panel = await region();
    expect(await within(panel).findByRole("alert")).toBeInTheDocument();
    expect(within(panel).queryByText("p01@example.com")).toBeNull();
    expect(within(panel).queryByText("lu-1")).toBeNull();
    expect(document.body.textContent).not.toContain("SSO-SENTINEL-9");
    expect(document.body.textContent).not.toContain("sso_user_id");
  });

  // Access Control - LiteLLM user sync, ~line 1033, S20: a placeholder keyed
  // by an SSO reference has no email in the row; the panel shows its LiteLLM
  // user id and Remove addresses it by that id. Contract: the row is
  // { litellmUserId, version, createdAt } with no `email`; the Remove button is
  // named "Remove <litellmUserId>" and sends DELETE { litellmUserId, version }.
  it("a row with no email shows its LiteLLM user id and Remove sends { litellmUserId, version } (S20)", async () => {
    const noEmail = {
      litellmUserId: "lu-sso-7",
      version: 3,
      createdAt: "2026-11-20T10:00:00.000Z",
    };
    const calls = stub(
      [{ items: [noEmail, item(2)] }, { items: [item(2)] }],
      apiResponse({ data: { litellmUserId: "lu-sso-7" } }),
    );
    renderWithProviders(<PendingLinksList canRemove />);
    const panel = await region();
    expect(await within(panel).findByText("lu-sso-7")).toBeInTheDocument();
    expect(within(panel).getByText("p02@example.com")).toBeInTheDocument();
    expect(panel.textContent).not.toContain("undefined");
    await userEvent.click(
      within(panel).getByRole("button", { name: "Remove lu-sso-7" }),
    );
    await waitFor(() =>
      expect(within(panel).queryByText("lu-sso-7")).toBeNull(),
    );
    const del = calls.find((c) => c.method === "DELETE");
    expect(del?.body).toEqual({ litellmUserId: "lu-sso-7", version: 3 });
  });
});
