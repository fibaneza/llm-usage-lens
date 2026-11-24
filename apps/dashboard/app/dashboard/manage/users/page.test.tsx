import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiResponse } from "@/test/fakes/api-stubs";
import {
  resetManageAccess,
  setManageAccess,
} from "@/test/fakes/manage-access-fake";
import { renderWithProviders } from "@/test/support/render-providers";

// Source: Design System - Management pages (Users: global readers only; page
// frame: PageHeader description, the h1 stays in the top bar) and Management
// improvements, Users (D15: the People list and Add user; each step and link control resolved on the server from the
// effective roles, Rule 10.3) and User link states (D16: Create and link on
// OSS only; LiteLLM spec - createUser: edition gate and toggle, "the UI hides
// or disables its control (reads return the caller's enabledOperations)").
// The users table (unit US1, 2026-11-24, D-US1: the separate "Search LiteLLM
// users" section is removed and the search box lives in the People panel;
// the lookup stays on Management -> LiteLLM -> LiteLLM users). The access matrix:
// lib/manage-users-access.integration.test.ts; the gate matrix:
// __tests__/manage-routes.integration.test.ts (Rule 60.24a). This file asserts
// the wiring.
//
// Contract (app/dashboard/manage/users/page.tsx): async Server Component, no
// props; notFound() unless managementAccessFor(...).users, or when
// usersPageAccessFor(...) is null; renders <PageHeader/>, the People panel,
// then nothing else: no LiteLLMSection, no UserSearch (unit US1).
vi.mock("@/auth", () => ({
  auth: vi.fn(),
  enabledSignInProviders: { entra: false, devLogin: true, master: false },
}));
vi.mock("@/lib/manage-access", async () => {
  const mod = await import("@/test/fakes/manage-access-fake");
  return mod.fakeManageAccess;
});
const usersPageAccessFor = vi.hoisted(() => vi.fn());
vi.mock("@/lib/manage-users-access", () => ({ usersPageAccessFor }));
const isLiteLLMConfigured = vi.hoisted(() => vi.fn());
const enabledOperations = vi.hoisted(() => vi.fn());
vi.mock("@/lib/litellm/client", () => ({ isLiteLLMConfigured }));
vi.mock("@/lib/litellm/read-views", () => ({ enabledOperations }));
vi.mock("../../settings/step-up-actions", () => ({
  stepUpWithCredentials: vi.fn(),
  stepUpWithDevLogin: vi.fn(),
  stepUpWithEntra: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import UsersManagePage from "./page";

const ACCESS = {
  steps: { password: true, team: true, link: true },
  ownOid: "oid-me",
  authMethod: "entra",
};
const LINKED_ROW = {
  ...{
    oid: "oid-ada",
    displayName: "Ada Lovelace",
    email: "ada@example.com",
    authMethod: "entra",
    memberTeamId: null,
    linkVersion: 1,
    match: null,
  },
  litellm: { state: "linked", litellmUserId: "ll-ada" },
};
const NONE_ROW = {
  oid: "oid-cy",
  displayName: "Cy Young",
  email: "cy@example.com",
  authMethod: "entra",
  memberTeamId: null,
  litellm: { state: "none" },
  linkVersion: 0,
  match: null,
};

function stubFetch(items: unknown[] = [NONE_ROW]) {
  const urls: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      urls.push(url);
      if (url.pathname === "/api/identities/directory") {
        return Promise.resolve(apiResponse({ data: { items } }));
      }
      if (url.pathname === "/api/access/org-units") {
        return Promise.resolve(
          apiResponse({ data: { teams: [], departments: [] } }),
        );
      }
      return Promise.resolve(apiResponse({ data: { items: [] } }));
    }),
  );
  return urls;
}

function litellm(configured: boolean, operations: string[]) {
  isLiteLLMConfigured.mockResolvedValue(configured);
  enabledOperations.mockResolvedValue(operations);
}

beforeEach(() => {
  usersPageAccessFor.mockResolvedValue(ACCESS);
  litellm(true, ["createUser"]);
});
afterEach(() => {
  resetManageAccess();
  usersPageAccessFor.mockReset();
  isLiteLLMConfigured.mockReset();
  enabledOperations.mockReset();
  vi.unstubAllGlobals();
});

describe("Users management page (/dashboard/manage/users)", () => {
  it("opens with a one-line description, no page-level h1 and the People panel holding the only search box; no separate search section (D-US1)", async () => {
    stubFetch();
    const view = renderWithProviders(await UsersManagePage());

    const description = view.container.querySelector("p");
    expect(description?.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    const people = await screen.findByRole("region", { name: "People" });
    expect(
      within(people).getByRole("button", { name: /add user/i }),
    ).toBeInTheDocument();
    expect(
      within(people).getByRole("searchbox", { name: /search/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "Search LiteLLM users" }),
    ).toBeNull();
    expect(screen.getAllByRole("searchbox")).toHaveLength(1);
  });

  it("answers the 404 when the caller may not see Users", async () => {
    setManageAccess({ users: false });
    await expect(UsersManagePage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("answers the 404 when the caller's page access cannot be resolved (fail closed)", async () => {
    usersPageAccessFor.mockResolvedValue(null);
    await expect(UsersManagePage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("hands the server-resolved steps to the page: no Add user for a caller with no step (D15)", async () => {
    usersPageAccessFor.mockResolvedValue({
      ...ACCESS,
      steps: { password: false, team: false, link: false },
    });
    stubFetch();
    renderWithProviders(await UsersManagePage());
    await screen.findByText("Cy Young");
    expect(screen.queryByRole("button", { name: /add user/i })).toBeNull();
  });

  // Create and link follows the server-side enabledOperations (edition and
  // toggle), not APP_ENV (LiteLLM spec - createUser; Design System - D16).
  it("shows Create and link when LiteLLM reports createUser enabled (OSS, toggle on; D16)", async () => {
    stubFetch();
    renderWithProviders(await UsersManagePage());
    expect(
      await screen.findByRole("button", { name: "Create and link" }),
    ).toBeInTheDocument();
  });

  it("shows no Create and link when LiteLLM reports createUser not enabled, whatever APP_ENV is (edition and toggle, not APP_ENV)", async () => {
    litellm(true, []);
    stubFetch();
    renderWithProviders(await UsersManagePage());
    expect(
      await screen.findByText("Sign in to LiteLLM once, then retry."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Create and link" }),
    ).toBeNull();
  });

  // LiteLLM spec LD37 (not configured is a handled state): the server decides
  // once, so the page makes no /api/litellm/* call (the CI=1 console-503
  // defect), omits include=litellmMatch and offers no Create and link.
  it("LiteLLM not configured: no include=litellmMatch, no /api/litellm request, no Create and link, the row says so (LD37)", async () => {
    litellm(false, ["createUser"]);
    const urls = stubFetch();
    renderWithProviders(await UsersManagePage());
    expect(
      await screen.findByText("LiteLLM not configured"),
    ).toBeInTheDocument();
    const directory = urls.filter(
      (u) => u.pathname === "/api/identities/directory",
    );
    expect(directory.length).toBeGreaterThan(0);
    expect(directory.every((u) => u.searchParams.get("include") === null)).toBe(
      true,
    );
    expect(urls.some((u) => u.pathname.startsWith("/api/litellm/"))).toBe(
      false,
    );
    expect(
      screen.queryByRole("button", { name: "Create and link" }),
    ).toBeNull();
    expect(enabledOperations).not.toHaveBeenCalled();
  });

  // RS1 (Design System - Reset spend from the LiteLLM users tab and the Users
  // page, D2-D4): the page resolves `canResetSpend` on the server: LiteLLM
  // configured AND resetMemberSpend enabled AND the caller's `steps.link`
  // (admin and org-admin; an Auditor has none). Row-level rules and the dialog
  // are in UsersPeoplePanel.test.tsx and ResetMemberSpendDialog.test.tsx.
  describe("Reset spend wiring (RS1)", () => {
    const resetButton = () =>
      screen.queryByRole("button", { name: "Reset spend for Ada Lovelace" });

    it("shows Reset spend on a linked person when the toggle is on and the caller may write", async () => {
      litellm(true, ["resetMemberSpend"]);
      stubFetch([LINKED_ROW]);
      renderWithProviders(await UsersManagePage());
      await screen.findByText("Ada Lovelace");
      expect(resetButton()).toBeInTheDocument();
    });

    it.each([
      ["the toggle is off", true, [], ACCESS.steps],
      [
        "the caller has no link/write step (Auditor)",
        true,
        ["resetMemberSpend"],
        { password: false, team: false, link: false },
      ],
      [
        "LiteLLM is not configured (LD37)",
        false,
        ["resetMemberSpend"],
        ACCESS.steps,
      ],
    ])("shows no Reset spend when %s", async (_n, configured, ops, steps) => {
      litellm(configured, ops);
      usersPageAccessFor.mockResolvedValue({ ...ACCESS, steps });
      stubFetch([LINKED_ROW]);
      renderWithProviders(await UsersManagePage());
      await screen.findByText("Ada Lovelace");
      expect(resetButton()).toBeNull();
    });
  });
});
