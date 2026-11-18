import { describe, expect, it, vi } from "vitest";

// Source: Design System - Routes and redirects (M1, D3, 2026-11-17):
// `/dashboard/settings/litellm/team-links` -> `/dashboard/manage/litellm/teams`,
// a server `redirect()` that keeps the query; the target page applies its own
// gate (gate matrix in __tests__/manage-routes.integration.test.ts).
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
  permanentRedirect: () => {
    throw new Error("permanentRedirect must not be used");
  },
}));

import MovedPage from "./page";

const go = async (params: Record<string, string | string[] | undefined>) => {
  try {
    await MovedPage({ searchParams: Promise.resolve(params) });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "no redirect";
};

const TARGET = "/dashboard/manage/litellm/teams";

describe("/dashboard/settings/litellm/team-links redirect (M1 D3)", () => {
  it("redirects to the Management -> LiteLLM tab", async () => {
    expect(await go({})).toBe(`NEXT_REDIRECT:${TARGET}`);
  });

  it("keeps the query (the date range)", async () => {
    const message = await go({ dateFrom: "2026-11-01", dateTo: "2026-11-14" });
    const url = new URL(
      message.replace("NEXT_REDIRECT:", ""),
      "http://localhost",
    );
    expect(url.pathname).toBe(TARGET);
    expect(url.searchParams.get("dateFrom")).toBe("2026-11-01");
    expect(url.searchParams.get("dateTo")).toBe("2026-11-14");
  });
});
