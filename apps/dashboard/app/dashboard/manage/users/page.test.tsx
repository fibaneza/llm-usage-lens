import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiResponse } from "@/test/fakes/api-stubs";
import {
  resetManageAccess,
  setManageAccess,
} from "@/test/fakes/manage-access-fake";
import { renderWithProviders } from "@/test/support/render-providers";

// Source: Design System - Management pages (Users: "the LiteLLM Users view
// unchanged in content, now its own route") and LiteLLM Page (the Settings
// Users tab and this page share one search component); page frame (PageHeader
// description, the h1 stays in the top bar); slice B2 brief B2-7. The search
// behaviour is tested in UserSearch.test.tsx (Rule 60.24a); the gate matrix in
// __tests__/manage-routes.integration.test.ts. This file asserts the wiring
// that moved here from LiteLLMContent.test.tsx.
//
// Contract (app/dashboard/manage/users/page.tsx): async Server Component, no
// props; notFound() unless managementAccessFor(...).users; renders
// <PageHeader description="..."/> then
// <LiteLLMSection title="Users"><UserSearch/></LiteLLMSection>.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/manage-access", async () => {
  const mod = await import("@/test/fakes/manage-access-fake");
  return mod.fakeManageAccess;
});
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import UsersManagePage from "./page";

afterEach(() => {
  resetManageAccess();
  vi.unstubAllGlobals();
});

describe("Users management page (/dashboard/manage/users)", () => {
  it("opens with a one-line description, no page-level h1, and a Users region holding the user search", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(apiResponse({ data: { items: [] } }))),
    );
    const view = renderWithProviders(await UsersManagePage());

    const description = view.container.querySelector("p");
    expect(description?.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    const region = await screen.findByRole("region", { name: "Users" });
    expect(
      within(region).getByRole("searchbox", { name: /search users/i }),
    ).toBeInTheDocument();
  });

  it("answers the 404 when the caller may not see Users", async () => {
    setManageAccess({ users: false });
    await expect(UsersManagePage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
