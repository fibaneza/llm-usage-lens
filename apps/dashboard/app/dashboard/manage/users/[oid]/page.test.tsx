import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  resetManageAccess,
  setManageAccess,
} from "@/test/fakes/manage-access-fake";

// Sources: Design System - "The user page (unit US2)": /dashboard/manage/users/
// [oid] is open to internal-admin, internal-org-admin and internal-auditor;
// anyone else, and an unknown oid, gets the missing-page 404; the link to
// Settings -> Access -> Password users only for the callers who see that
// section (D-US10; role-impact US2: admin, auditor shown, org-admin absent).
// Access Control - Enforcement item 2 (hidden means absent and 404), T-US1.
// The caller x page matrix against the real managementAccessFor runs in
// lib/manage-access.integration.test.ts; the per-role body in the route test
// (Rule 60.24a). This file asserts the wiring.
//
// Contract (app/dashboard/manage/users/[oid]/page.tsx): default async Server
// Component, props { params: Promise<{ oid: string }> }.
//   1. managementAccessFor(session).users false -> notFound(), and the detail
//      is never read (lead, user, no session).
//   2. loadIdentityDetail(session, oid) from "@/lib/manage/user-detail" (the
//      builder GET /api/identities/[oid] shares; null for an unknown oid or a
//      caller it refuses) null -> notFound().
//   3. loadSettingsAccessViewer(session) null -> notFound() (fail closed).
//   4. renders <UserDetailContent detail canOpenPasswordUsers authMethod
//      stepUp />, canOpenPasswordUsers = accessCapabilities(viewer)
//      .passwordUsers !== "none".
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/manage-access", async () => {
  const mod = await import("@/test/fakes/manage-access-fake");
  return mod.fakeManageAccess;
});
const loadIdentityDetail = vi.hoisted(() => vi.fn());
vi.mock("@/lib/manage/user-detail", () => ({ loadIdentityDetail }));
const withLiteLLMSuggestion = vi.hoisted(() => vi.fn());
vi.mock("@/lib/manage/litellm-email-suggestion", () => ({
  withLiteLLMSuggestion,
}));
const loadViewer = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/settings-access", () => ({
  loadSettingsAccessViewer: (session: unknown) => loadViewer(session),
}));
vi.mock("../../../settings/step-up-actions", () => ({
  stepUpWithCredentials: vi.fn(),
  stepUpWithDevLogin: vi.fn(),
  stepUpWithEntra: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/components/manage/users/detail/UserDetailContent", () => ({
  UserDetailContent: (props: {
    detail: { oid: string; suggestion?: string };
    canOpenPasswordUsers: boolean;
    authMethod: string;
  }) => (
    <div
      data-testid="user-detail"
      data-oid={props.detail.oid}
      data-suggestion={props.detail.suggestion}
      data-can-open-password-users={String(props.canOpenPasswordUsers)}
      data-auth-method={props.authMethod}
    />
  ),
}));

import { auth } from "@/auth";

import UserDetailPage from "./page";

const DETAIL = { oid: "oid-alice", displayName: "Alice" };
const viewerOf = (roles: string[]) => ({
  roles,
  authMethod: "entra" as const,
  adminScopes: [],
});

async function open(oid = "oid-alice") {
  return render(await UserDetailPage({ params: Promise.resolve({ oid }) }));
}

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({
    user: { oid: "oid-me", roles: ["internal-admin"] },
  } as never);
  loadIdentityDetail.mockResolvedValue(DETAIL);
  withLiteLLMSuggestion.mockImplementation(async (d: unknown) => d);
  loadViewer.mockResolvedValue(viewerOf(["internal-admin"]));
});
afterEach(() => {
  resetManageAccess();
  loadIdentityDetail.mockReset();
  loadViewer.mockReset();
  withLiteLLMSuggestion.mockReset();
});

describe("the user page (/dashboard/manage/users/[oid])", () => {
  it.each([
    ["internal-admin", true],
    ["internal-org-admin", false],
    ["internal-auditor", true],
  ])(
    "%s gets the page; the Password users link is offered: %s (D-US10)",
    async (role, linkOffered) => {
      loadViewer.mockResolvedValue(viewerOf([role]));
      await open();
      const content = screen.getByTestId("user-detail");
      expect(content).toHaveAttribute("data-oid", "oid-alice");
      expect(content).toHaveAttribute(
        "data-can-open-password-users",
        String(linkOffered),
      );
      expect(content).toHaveAttribute("data-auth-method", "entra");
      expect(loadIdentityDetail).toHaveBeenCalledWith(
        expect.anything(),
        "oid-alice",
      );
    },
  );

  it.each([
    ["a team lead", "internal-viewer"],
    ["a plain user", "internal-viewer"],
  ])(
    "%s gets the missing-page 404 and the detail is never read",
    async (_who, role) => {
      setManageAccess({ users: false, global: false });
      loadViewer.mockResolvedValue(viewerOf([role]));
      await expect(open()).rejects.toThrow("NEXT_NOT_FOUND");
      expect(loadIdentityDetail).not.toHaveBeenCalled();
    },
  );

  it("no session gets the 404 and the detail is never read", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    setManageAccess({ users: false, global: false });
    loadViewer.mockResolvedValue(null);
    await expect(open()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(loadIdentityDetail).not.toHaveBeenCalled();
  });

  // R3 (Design System - The user page, 2026-11-24 rulings): the page validates
  // oid with IdParamSchema before reading, as GET /api/identities/[oid] does.
  it.each([
    ["a control character", "bad\u0001oid"],
    ["more than 128 characters", "x".repeat(129)],
  ])(
    "an oid with %s is the 404 and the loader is never called (R3)",
    async (_n, oid) => {
      await expect(open(oid)).rejects.toThrow("NEXT_NOT_FOUND");
      expect(loadIdentityDetail).not.toHaveBeenCalled();
    },
  );

  it("a percent-encoded page param is decoded once before the loader (Data Model API Routes path ids, T-US1)", async () => {
    await open("local%3Aabc");
    expect(loadIdentityDetail).toHaveBeenCalledWith(
      expect.anything(),
      "local:abc",
    );
  });

  it("an unknown oid (the loader answers null) is the 404 (T-US1: same page as a refusal)", async () => {
    loadIdentityDetail.mockResolvedValue(null);
    await expect(open("no-such-person")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("a session that builds no viewer fails closed with the 404", async () => {
    loadViewer.mockResolvedValue(null);
    await expect(open()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  // Access Control - /api/identities/[oid], D-UP1a: the page renders what the
  // guarded suggestion helper returns, applied to the loaded detail.
  it("renders the detail the suggestion helper returns, built from the loaded detail (D-UP1a)", async () => {
    withLiteLLMSuggestion.mockImplementation(async (d: object) => ({
      ...d,
      suggestion: "from-helper",
    }));
    await open();
    expect(withLiteLLMSuggestion).toHaveBeenCalledWith(DETAIL);
    expect(screen.getByTestId("user-detail")).toHaveAttribute(
      "data-suggestion",
      "from-helper",
    );
  });
});
