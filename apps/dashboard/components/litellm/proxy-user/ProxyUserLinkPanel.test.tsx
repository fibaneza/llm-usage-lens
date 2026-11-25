import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiError } from "@/test/fakes/api-stubs";
import {
  OID_ADA,
  PROXY_USER,
  PROXY_USER_CAPPED,
  PROXY_USER_ID,
  PROXY_USER_UNLINKED,
  stubProxyUser,
} from "@/test/fixtures/proxy-user";
import { renderWithProviders } from "@/test/support/render-providers";

import { ProxyUserLinkPanel } from "./ProxyUserLinkPanel";

// Sources: Design System - LiteLLM user page (unit LP2, D-R3-8, D-R3-9),
// T-LP8 and T-LP9: "the linked dashboard person with their team (a link to the
// user page), or 'Not linked to a dashboard user'. Reset spend and Link /
// Unlink are there for the callers who have them on the tab today"; Access
// Control - LiteLLM user links (a link write on the caller's own identity is
// 403, so no control is offered on one's own row; admin and org-admin write,
// the auditor reads); LiteLLM spec - RS2 / LD39 (Reset spend by LiteLLM id,
// resetUserSpend), LD23 (links are not cost: the cap does not hide them).
// Rule 40.4, 60.24a.
//
// Contract: ProxyUserLinkPanel({ litellmUserId, canWrite, ownOid }) in
// components/litellm/proxy-user/ProxyUserLinkPanel.tsx. `canWrite` is the
// caller's write flag (true for internal-admin and internal-org-admin, false
// for internal-auditor); `ownOid` is the caller's own oid or null. A Panel
// region "Linked dashboard user" reading the shared useProxyUser entry. A linked
// person shows their name as a link to /dashboard/manage/users/<encoded oid>,
// their email and their app team's name; the Unlink control (the tab's
// LiteLLMLinkCell) needs the link version, read from GET /api/identities/<oid>
// (`linkVersion`), and is offered only with canWrite and not on one's own
// person. Reset spend (ResetMemberSpendDialog, `userReset`, button "Reset spend
// for <name>", name = the person's name, else the LiteLLM email) is offered with
// canWrite, not on one's own row, and when the answer's enabledOperations has
// resetUserSpend or resetMemberSpend, for a linked or an unlinked user.
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  refresh.mockReset();
});

const render = (canWrite = true, ownOid: string | null = "oid-someone-else") =>
  renderWithProviders(
    <ProxyUserLinkPanel
      litellmUserId={PROXY_USER_ID}
      canWrite={canWrite}
      ownOid={ownOid}
    />,
    { searchParams: { dateFrom: "2026-11-01", dateTo: "2026-11-30" } },
  );
const panel = () =>
  screen.findByRole("region", { name: "Linked dashboard user" });

describe("ProxyUserLinkPanel (T-LP8)", () => {
  it("T-LP8: a linked user shows the person's name as a link to their user page, their email and their team", async () => {
    stubProxyUser();
    render(false);
    const region = await panel();
    expect(
      await within(region).findByRole("link", { name: "Ada Lovelace" }),
    ).toHaveAttribute("href", `/dashboard/manage/users/${OID_ADA}`);
    expect(within(region).getByText("ada@example.test")).toBeVisible();
    expect(within(region).getByText("Payments")).toBeVisible();
    expect(within(region).queryByText(/not linked/i)).toBeNull();
  });

  it("T-LP8: the person's oid is percent-encoded in the link", async () => {
    stubProxyUser({
      user: {
        ...PROXY_USER,
        appUser: { ...PROXY_USER.appUser, oid: "oid/ada 1" },
      },
    });
    render(false);
    expect(
      await within(await panel()).findByRole("link", { name: "Ada Lovelace" }),
    ).toHaveAttribute("href", "/dashboard/manage/users/oid%2Fada%201");
  });

  it("T-LP8: a linked person with no team still shows the person and no error", async () => {
    stubProxyUser({
      user: {
        ...PROXY_USER,
        appUser: { ...PROXY_USER.appUser, appTeam: null },
      },
    });
    render(false);
    const region = await panel();
    expect(
      await within(region).findByRole("link", { name: "Ada Lovelace" }),
    ).toBeVisible();
    expect(within(region).queryByRole("alert")).toBeNull();
  });

  it("T-LP8: an unlinked user says 'Not linked to a dashboard user' and shows no person", async () => {
    stubProxyUser({ user: PROXY_USER_UNLINKED });
    render(false);
    const region = await panel();
    expect(
      await within(region).findByText("Not linked to a dashboard user"),
    ).toBeVisible();
    expect(within(region).queryAllByRole("link")).toHaveLength(0);
  });

  it("T-LP8 / LD23: under the Organisation cap the links still show (links are not cost)", async () => {
    stubProxyUser({ user: PROXY_USER_CAPPED });
    render(false);
    expect(
      await within(await panel()).findByRole("link", { name: "Ada Lovelace" }),
    ).toBeVisible();
  });

  it("Rule 40.4: a failed read shows the panel's own error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubProxyUser({ user: () => apiError(500, "INTERNAL_ERROR", "boom") });
    render();
    expect(
      await screen.findByText("Couldn't load Linked dashboard user."),
    ).toBeInTheDocument();
  });
});

describe("ProxyUserLinkPanel controls (T-LP9)", () => {
  it("T-LP9: with canWrite a linked person has Unlink and Reset spend", async () => {
    stubProxyUser();
    render(true);
    const region = await panel();
    expect(
      await within(region).findByRole("button", { name: /^unlink$/i }),
    ).toBeVisible();
    expect(
      within(region).getByRole("button", {
        name: "Reset spend for Ada Lovelace",
      }),
    ).toBeVisible();
  });

  it("T-LP9: Unlink confirms, then DELETEs /api/identities/<oid>/litellm-link with the link version read from the identity", async () => {
    const calls = stubProxyUser();
    const user = userEvent.setup();
    render(true);
    await user.click(
      await within(await panel()).findByRole("button", { name: /^unlink$/i }),
    );
    await user.click(
      await screen.findByRole("button", { name: /remove link/i }),
    );
    await waitFor(() =>
      expect(calls.filter((c) => c.method === "DELETE")).toEqual([
        {
          method: "DELETE",
          path: `/api/identities/${OID_ADA}/litellm-link`,
          body: { version: 4 },
        },
      ]),
    );
  });

  it("T-LP9: opening Unlink writes nothing until confirmed", async () => {
    const calls = stubProxyUser();
    const user = userEvent.setup();
    render(true);
    await user.click(
      await within(await panel()).findByRole("button", { name: /^unlink$/i }),
    );
    await screen.findByRole("alertdialog");
    expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
  });

  it("T-LP9: Reset spend opens the dialog for that person and reads that LiteLLM user's memberships; nothing is written by opening it", async () => {
    const calls = stubProxyUser();
    const user = userEvent.setup();
    render(true);
    await user.click(
      await screen.findByRole("button", {
        name: "Reset spend for Ada Lovelace",
      }),
    );
    expect(
      await screen.findByRole("alertdialog", {
        name: "Reset spend for Ada Lovelace?",
      }),
    ).toBeVisible();
    expect(
      calls.some((c) => c.path === "/api/litellm/users/ll-ada/memberships"),
    ).toBe(true);
    expect(calls.filter((c) => c.method !== "GET")).toEqual([]);
  });

  it("T-LP9 / RS2: an unlinked user has Reset spend named by the LiteLLM email, and no Unlink", async () => {
    stubProxyUser({ user: PROXY_USER_UNLINKED });
    render(true);
    const region = await panel();
    expect(
      await screen.findByRole("button", {
        name: "Reset spend for ada@example.test",
      }),
    ).toBeVisible();
    expect(
      within(region).queryByRole("button", { name: /unlink/i }),
    ).toBeNull();
  });

  it("T-LP9: without canWrite (the auditor) there is no Unlink and no Reset spend", async () => {
    const calls = stubProxyUser();
    render(false);
    const region = await panel();
    await within(region).findByRole("link", { name: "Ada Lovelace" });
    expect(within(region).queryAllByRole("button")).toHaveLength(0);
    expect(calls.some((c) => c.path.startsWith("/api/identities/"))).toBe(
      false,
    );
  });

  it("T-LP9 / Access Control: on the caller's own person there is no Unlink and no Reset spend", async () => {
    stubProxyUser();
    render(true, OID_ADA);
    const region = await panel();
    await within(region).findByRole("link", { name: "Ada Lovelace" });
    expect(within(region).queryAllByRole("button")).toHaveLength(0);
  });

  it("T-LP9 / RS2: Reset spend is absent when neither reset operation is enabled (absent, never dead)", async () => {
    stubProxyUser({ user: { ...PROXY_USER, enabledOperations: [] } });
    render(true);
    const region = await panel();
    await within(region).findByRole("link", { name: "Ada Lovelace" });
    expect(
      within(region).queryByRole("button", { name: /reset spend/i }),
    ).toBeNull();
  });
});
