import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { IdentityDetail } from "@llm-usage-lens/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  isLiteLLMConfigured: vi.fn(),
  openModeRefusal: vi.fn(),
  findUserByEmail: vi.fn(),
  recordException: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@opentelemetry/api", () => ({
  trace: { getActiveSpan: () => ({ recordException: m.recordException }) },
}));
vi.mock("@/lib/litellm/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/litellm/client")>()),
  isLiteLLMConfigured: m.isLiteLLMConfigured,
}));
vi.mock("@/lib/litellm/operations", () => ({
  findUserByEmail: m.findUserByEmail,
}));
vi.mock("@/lib/litellm/route-guard", async () => {
  const { LiteLLMError } = await import("@/lib/litellm/client");
  return {
    openModeRefusal: m.openModeRefusal,
    liteLLMErrorResponse: (e: unknown) =>
      e instanceof LiteLLMError ? new Response(null, { status: 503 }) : null,
  };
});

import { LiteLLMError } from "@/lib/litellm/client";

import { withLiteLLMSuggestion } from "./litellm-email-suggestion";

// Source: docs/specs/2026-11-10-access-control.md - the `/api/identities/[oid]`
// row incl. D-UP1a; Design System - "Users, round 3" T-UP5 (the user page's
// LiteLLM state equals the list's for the same person; the read returns the
// match only to a caller who may link; an auditor sees "Not linked").

function detailOf(
  over: {
    linkLiteLLM?: boolean;
    litellm?: IdentityDetail["litellm"];
  } = {},
): IdentityDetail {
  return {
    oid: "oid-1",
    email: "Ada@Example.com",
    litellm: over.litellm ?? { state: "none" },
    allowed: { linkLiteLLM: over.linkLiteLLM ?? true },
  } as unknown as IdentityDetail;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.isLiteLLMConfigured.mockResolvedValue(true);
  m.openModeRefusal.mockReturnValue(null);
  m.findUserByEmail.mockResolvedValue({
    users: [{ user_id: "ll-1", user_email: "ada@example.com" }],
  });
});

describe("withLiteLLMSuggestion (T-UP5, D-UP1a)", () => {
  it("returns a match for an unlinked person when the caller may link, with one lookup", async () => {
    const out = await withLiteLLMSuggestion(detailOf());
    expect(out.litellm).toEqual({
      state: "match",
      litellmUserId: "ll-1",
      email: "ada@example.com",
    });
    expect(m.findUserByEmail).toHaveBeenCalledTimes(1);
  });

  it("keeps the rest of the detail unchanged on a match", async () => {
    const input = detailOf();
    const out = await withLiteLLMSuggestion(input);
    expect({ ...out, litellm: null }).toEqual({ ...input, litellm: null });
  });

  it("returns the detail unchanged when no LiteLLM user has that email", async () => {
    m.findUserByEmail.mockResolvedValue({ users: [] });
    const out = await withLiteLLMSuggestion(detailOf());
    expect(out.litellm).toEqual({ state: "none" });
  });

  it.each([
    ["the caller may not link (auditor, self)", { linkLiteLLM: false }],
    ["already linked", { litellm: { state: "linked", litellmUserId: "x" } }],
  ])("makes no lookup and exposes nothing when %s", async (_n, over) => {
    const input = detailOf(over as Parameters<typeof detailOf>[0]);
    const out = await withLiteLLMSuggestion(input);
    expect(out).toEqual(input);
    expect(JSON.stringify(out.litellm)).not.toContain("ll-1");
    expect(m.findUserByEmail).not.toHaveBeenCalled();
  });

  it("makes no lookup when LiteLLM is not configured", async () => {
    m.isLiteLLMConfigured.mockResolvedValue(false);
    const out = await withLiteLLMSuggestion(detailOf());
    expect(out.litellm).toEqual({ state: "none" });
    expect(m.findUserByEmail).not.toHaveBeenCalled();
  });

  it("makes no lookup in open access mode (LT11)", async () => {
    m.openModeRefusal.mockReturnValue(new Response(null, { status: 403 }));
    const out = await withLiteLLMSuggestion(detailOf());
    expect(out.litellm).toEqual({ state: "none" });
    expect(m.findUserByEmail).not.toHaveBeenCalled();
  });

  it("fails closed on a LiteLLM outage: unchanged none, exception recorded, no raw error", async () => {
    m.findUserByEmail.mockRejectedValue(new LiteLLMError("unreachable"));
    const out = await withLiteLLMSuggestion(detailOf());
    expect(out.litellm).toEqual({ state: "none" });
    expect(m.recordException).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(out)).not.toMatch(/unreachable|LITELLM_UNAVAILABLE/);
  });

  it("rethrows an error that is not a LiteLLM failure", async () => {
    m.findUserByEmail.mockRejectedValue(new TypeError("boom"));
    await expect(withLiteLLMSuggestion(detailOf())).rejects.toThrow("boom");
  });
});

describe("one helper holds the guards (T-UP5: list and page agree)", () => {
  const dash = resolve(__dirname, "../..");
  const route = readFileSync(
    resolve(dash, "app/api/identities/[oid]/route.ts"),
    "utf8",
  );
  const page = readFileSync(
    resolve(dash, "app/dashboard/manage/users/[oid]/page.tsx"),
    "utf8",
  );

  it("route.ts and page.tsx both call withLiteLLMSuggestion", () => {
    expect(route).toMatch(/withLiteLLMSuggestion\(/);
    expect(page).toMatch(/withLiteLLMSuggestion\(/);
  });

  it("route.ts no longer applies the guards itself", () => {
    expect(route).not.toMatch(/suggestLiteLLMUserByEmail/);
    expect(route).not.toMatch(/isLiteLLMConfigured/);
    expect(route).not.toMatch(/openModeRefusal/);
  });
});
