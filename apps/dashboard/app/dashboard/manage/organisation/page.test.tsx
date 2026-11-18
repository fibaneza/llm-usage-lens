import { describe, expect, it, vi } from "vitest";

// Source: Design System - Routes and redirects (M1, D3, 2026-11-17):
// `/dashboard/manage/organisation` -> `/dashboard/manage/litellm/organisation`,
// a server `redirect()` (reversible, never permanent) that keeps the query (the
// date range). The target page applies its own gate (Access Control - Hidden
// means absent), asserted in __tests__/manage-routes.integration.test.ts.
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
  permanentRedirect: () => {
    throw new Error("permanentRedirect must not be used");
  },
}));

import OrganisationPage from "./page";

const go = async (params: Record<string, string | string[] | undefined>) => {
  try {
    await OrganisationPage({ searchParams: Promise.resolve(params) });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "no redirect";
};

describe("/dashboard/manage/organisation redirect (M1 D3)", () => {
  it("redirects to the Organisation tab of Management -> LiteLLM", async () => {
    expect(await go({})).toBe(
      "NEXT_REDIRECT:/dashboard/manage/litellm/organisation",
    );
  });

  it("keeps the query (the date range), repeated values included", async () => {
    const message = await go({
      dateFrom: "2026-11-01",
      dateTo: "2026-11-14",
      team: ["a", "b"],
    });
    const url = new URL(
      message.replace("NEXT_REDIRECT:", ""),
      "http://localhost",
    );
    expect(url.pathname).toBe("/dashboard/manage/litellm/organisation");
    expect(url.searchParams.get("dateFrom")).toBe("2026-11-01");
    expect(url.searchParams.get("dateTo")).toBe("2026-11-14");
    expect(url.searchParams.getAll("team")).toEqual(["a", "b"]);
  });
});
