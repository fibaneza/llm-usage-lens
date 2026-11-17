import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiError } from "@/test/fakes/api-stubs";
import {
  resetManageAccess,
  setManageAccess,
} from "@/test/fakes/manage-access-fake";
import { renderWithProviders } from "@/test/support/render-providers";

// Source: Design System - Management pages (Organisation: "the LiteLLM
// Organisation view unchanged in content, now its own route"; page frame:
// PageHeader with a one-line description, the h1 stays in the top bar; every
// section its own Suspense + ErrorBoundary, Rule 40.4); LiteLLM spec - Views
// by role (Organisation: global readers; "LiteLLM-reported"); slice B2 brief
// B2-7. The section's own behaviour is tested in OrganisationSection.test.tsx
// (Rule 60.24a); the caller x route gate in
// __tests__/manage-routes.integration.test.ts. This file asserts the page
// wiring that moved here from LiteLLMContent.test.tsx: an "Organisation"
// region with its own boundary, the LiteLLM-reported label, the header.
//
// Contract (app/dashboard/manage/organisation/page.tsx): async Server
// Component, no props; notFound() unless managementAccessFor(...).organisation;
// renders <PageHeader description="..."/> then
// <LiteLLMSection title="Organisation" reported><OrganisationSection/></LiteLLMSection>.
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

import OrganisationPage from "./page";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  resetManageAccess();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("OrganisationPage (/dashboard/manage/organisation)", () => {
  it("opens with a one-line description, no page-level h1, and the Organisation region", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(apiError(500))),
    );
    const view = renderWithProviders(await OrganisationPage());

    const description = view.container.querySelector("p");
    expect(description?.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(
      await screen.findByRole("region", { name: "Organisation" }),
    ).toBeInTheDocument();
  });

  it("a failing organisation read is contained in its own region (Rule 40.4)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(apiError(500))),
    );
    renderWithProviders(await OrganisationPage());

    const region = await screen.findByRole("region", { name: "Organisation" });
    expect(await within(region).findByRole("alert")).toHaveTextContent(
      /couldn't load/i,
    );
  });

  it("answers the 404 when the caller may not see Organisation", async () => {
    setManageAccess({ organisation: false });
    await expect(OrganisationPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
