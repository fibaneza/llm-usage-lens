import { afterEach, describe, expect, it, vi } from "vitest";

// Source: Design System - Management pages, LiteLLM area and Routes and
// redirects (M1, D2): the index `/dashboard/manage/litellm` redirects on the
// server (reversible redirect(), never permanent) to the caller's first visible
// tab - all three tabs follow the one `litellm` flag, so Organisation - and
// keeps the query (the date range); a caller without the flag gets the
// missing-page 404 (Access Control MI-D2; Rule 10.3).
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/manage-access", async () => {
  const mod = await import("@/test/fakes/manage-access-fake");
  return mod.fakeManageAccess;
});
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

import {
  resetManageAccess,
  setManageAccess,
} from "@/test/fakes/manage-access-fake";

import LiteLLMAreaIndexPage from "./page";

afterEach(() => resetManageAccess());

const go = async (params: Record<string, string | string[] | undefined>) => {
  try {
    await LiteLLMAreaIndexPage({ searchParams: Promise.resolve(params) });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "no redirect";
};

describe("LiteLLM area index (M1 D2)", () => {
  it("redirects to Organisation, the first visible tab", async () => {
    expect(await go({})).toBe(
      "NEXT_REDIRECT:/dashboard/manage/litellm/organisation",
    );
  });

  it("keeps the query (the date range)", async () => {
    const message = await go({ dateFrom: "2026-11-01", dateTo: "2026-11-14" });
    const url = new URL(
      message.replace("NEXT_REDIRECT:", ""),
      "http://localhost",
    );
    expect(url.pathname).toBe("/dashboard/manage/litellm/organisation");
    expect(url.searchParams.get("dateFrom")).toBe("2026-11-01");
    expect(url.searchParams.get("dateTo")).toBe("2026-11-14");
  });

  it("answers the 404 (no redirect) without the litellm flag", async () => {
    setManageAccess({ litellm: false });
    expect(await go({})).toBe("NEXT_NOT_FOUND");
  });
});
