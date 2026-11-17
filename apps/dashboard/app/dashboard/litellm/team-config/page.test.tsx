import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

// Source: Design System - LiteLLM Page, *Team configuration page* ("the interim
// route redirects there", to Management -> Team); slice B2 brief B2-3
// (`/dashboard/litellm/team-config[?team=x]` -> `/dashboard/manage/team[?team=x]`
// with a server `redirect()`); Rule 60.7. The Lead / org-admin / admin gate,
// the `?team=` scope check and `canRaiseLimits` moved to the Team page
// (app/dashboard/manage/team/page.test.tsx), where a caller who may not see
// the target gets the same 404.
//
// Contract (app/dashboard/litellm/team-config/page.tsx): default async Server
// Component, props { searchParams: Promise<{ team?: string; ... }> }, no data
// read.
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
  permanentRedirect: () => {
    throw new Error("permanentRedirect must not be used");
  },
}));

import TeamConfigPage from "./page";

const go = async (params: Record<string, string | undefined>) => {
  try {
    await TeamConfigPage({ searchParams: Promise.resolve(params) });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "no redirect";
};

describe("TeamConfigPage (/dashboard/litellm/team-config) redirect (B2-3)", () => {
  it("is a Server Component and never a permanent redirect (Rule 60.7)", () => {
    const source = readFileSync(
      resolve(import.meta.dirname, "page.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/^\s*["']use client["']/m);
    expect(source).not.toMatch(/permanentRedirect/);
  });

  it("redirects to the Team page", async () => {
    expect(await go({})).toBe("NEXT_REDIRECT:/dashboard/manage/team");
  });

  it("carries ?team= to the Team page", async () => {
    expect(await go({ team: "t1" })).toBe(
      "NEXT_REDIRECT:/dashboard/manage/team?team=t1",
    );
  });
});
