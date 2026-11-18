import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Source: Design System - Management pages, LiteLLM area (M1, D2): the layout
// opens with a PageHeader one-line description above the route tabs, no
// page-level h1 (it stays in the top bar); a caller without the `litellm`
// flag gets the missing-page 404 (Access Control MI-D2: hidden means absent;
// a layout is not re-run on soft navigation, so each tab page gates too -
// see [tab]/page.test.tsx). The flag per role is asserted against real policy
// inputs in __tests__/manage-routes.integration.test.ts.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/manage-access", async () => {
  const mod = await import("@/test/fakes/manage-access-fake");
  return mod.fakeManageAccess;
});
vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/manage/litellm/teams",
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import {
  resetManageAccess,
  setManageAccess,
} from "@/test/fakes/manage-access-fake";

import LiteLLMAreaLayout from "./layout";

afterEach(() => resetManageAccess());

describe("LiteLLM area layout (M1 D2)", () => {
  it("renders a description, the LiteLLM sections tab row and the children, with no h1", async () => {
    const view = render(
      await LiteLLMAreaLayout({ children: <div data-testid="child" /> }),
    );
    expect(
      view.container.querySelector("p")?.textContent?.trim().length ?? 0,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(
      screen.getByRole("tablist", { name: "LiteLLM sections" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  it("answers the 404 when the caller lacks the litellm flag", async () => {
    setManageAccess({ litellm: false });
    await expect(
      LiteLLMAreaLayout({ children: <div data-testid="child" /> }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("keys the gate on litellm, not on the retired organisation flag or users", async () => {
    setManageAccess({ users: false, team: false });
    await expect(
      LiteLLMAreaLayout({ children: <div /> }),
    ).resolves.toBeTruthy();
  });
});
