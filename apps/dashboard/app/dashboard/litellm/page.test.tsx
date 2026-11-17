import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

// Source: Design System - Navigation (Sidebar), *Routes and redirects*:
// "`/dashboard/litellm` -> the caller's landing page;
// `/dashboard/litellm?tab=my-usage|team|organisation|users|audit` -> the
// matching Management route (other query parameters carried)"; slice B2 brief
// B2-3 (server `redirect()`, reversible, never `permanentRedirect`: `team` ->
// /dashboard/manage/team, `organisation`, `users`, `audit` likewise, anything
// else or none -> /dashboard/me; "a redirect target the caller may not see
// 404s there" is the target page's gate, asserted in the manage-routes
// integration matrix, not here); Access Control - Hidden means absent and 404;
// Rule 60.7. The page is the redirect only: the LiteLLM tab row
// (LiteLLMContent) is gone.
//
// Contract (app/dashboard/litellm/page.tsx): default async Server Component,
// props { searchParams: Promise<Record<string, string | string[] | undefined>> },
// no data read, calls redirect() from next/navigation.
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
  permanentRedirect: () => {
    throw new Error("permanentRedirect must not be used");
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import LiteLLMPage from "./page";

const go = async (params: Record<string, string | string[] | undefined>) => {
  try {
    await LiteLLMPage({ searchParams: Promise.resolve(params) });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "no redirect";
};

describe("LiteLLMPage (/dashboard/litellm) redirect (B2-3)", () => {
  it("is a Server Component (Rule 60.7)", () => {
    const source = readFileSync(
      resolve(import.meta.dirname, "page.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/^\s*["']use client["']/m);
    expect(source).not.toMatch(/permanentRedirect/);
  });

  it.each([
    ["team", "/dashboard/manage/team"],
    ["organisation", "/dashboard/manage/organisation"],
    ["users", "/dashboard/manage/users"],
    ["audit", "/dashboard/manage/audit"],
  ])("?tab=%s redirects to %s", async (tab, target) => {
    expect(await go({ tab })).toBe(`NEXT_REDIRECT:${target}`);
  });

  it.each([
    ["no tab", {}],
    ["my-usage", { tab: "my-usage" }],
    ["an unknown tab", { tab: "bogus" }],
    ["a repeated tab (array)", { tab: ["team", "audit"] }],
  ])("%s redirects to My usage", async (_name, params) => {
    expect(await go(params)).toBe("NEXT_REDIRECT:/dashboard/me");
  });

  it("carries the other query parameters (the date range) and drops tab", async () => {
    const message = await go({
      tab: "team",
      dateFrom: "2026-11-01",
      dateTo: "2026-11-14",
    });
    const url = new URL(
      message.replace("NEXT_REDIRECT:", ""),
      "http://localhost",
    );
    expect(url.pathname).toBe("/dashboard/manage/team");
    expect(url.searchParams.get("dateFrom")).toBe("2026-11-01");
    expect(url.searchParams.get("dateTo")).toBe("2026-11-14");
    expect(url.searchParams.has("tab")).toBe(false);
  });

  // Prototype keys must not index the tab map (B2 review): they are "anything else".
  it.each(["__proto__", "constructor", "toString"])(
    "?tab=%s redirects to /dashboard/me",
    async (tab) => {
      expect(await go({ tab })).toBe("NEXT_REDIRECT:/dashboard/me");
    },
  );
});
