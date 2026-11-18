import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LiteLLMAreaTabs } from "./LiteLLMAreaTabs";

// Source: Design System - Management pages, LiteLLM area (M1, D2, 2026-11-17):
// three route tabs - Organisation, LiteLLM teams, LiteLLM users - on the one
// Tabs component (Rule 40.9); each a link to its route, the active one taken
// from the pathname with aria-current="page" (deep links, Back).
const pathname = vi.hoisted(() => ({
  current: "/dashboard/manage/litellm/organisation",
}));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));

beforeEach(() => {
  pathname.current = "/dashboard/manage/litellm/organisation";
});

const tabs = () =>
  within(
    screen.getByRole("tablist", { name: "LiteLLM sections" }),
  ).getAllByRole("tab");

describe("LiteLLMAreaTabs", () => {
  it("lists the three tabs in order as links to their routes", () => {
    render(<LiteLLMAreaTabs />);
    expect(
      tabs().map((t) => [t.textContent?.trim(), t.getAttribute("href")]),
    ).toEqual([
      ["Organisation", "/dashboard/manage/litellm/organisation"],
      ["LiteLLM teams", "/dashboard/manage/litellm/teams"],
      ["LiteLLM users", "/dashboard/manage/litellm/users"],
    ]);
  });

  it.each([
    ["/dashboard/manage/litellm/organisation", "Organisation"],
    ["/dashboard/manage/litellm/teams", "LiteLLM teams"],
    ["/dashboard/manage/litellm/users", "LiteLLM users"],
  ])("on %s only %s is the current tab", (path, name) => {
    pathname.current = path;
    render(<LiteLLMAreaTabs />);
    for (const tab of tabs()) {
      if (tab.textContent?.trim() === name) {
        expect(tab).toHaveAttribute("aria-current", "page");
      } else {
        expect(tab).not.toHaveAttribute("aria-current");
      }
    }
  });

  it("marks no tab current on the area index", () => {
    pathname.current = "/dashboard/manage/litellm";
    render(<LiteLLMAreaTabs />);
    for (const tab of tabs()) expect(tab).not.toHaveAttribute("aria-current");
  });
});
