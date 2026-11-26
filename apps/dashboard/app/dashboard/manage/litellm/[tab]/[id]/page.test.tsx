import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Sources: Design System - LiteLLM team page (unit LP1, D-R3-7, D-R3-9),
// T-LP4: "/dashboard/manage/litellm/teams/[litellmTeamId], for internal-admin,
// internal-org-admin and internal-auditor; anyone else, and an unknown id, gets
// the missing page"; Access Control MI-D2 (hidden means absent; a lead and a
// user get the 404), Rule 10.3 / 60.10 (authorized per request, never cached),
// Rule 60.7 (a page is a Server Component), Rule 60.13 and
// lib/api/id-param.ts parsePageIdParam (the page param arrives percent-encoded:
// decode once, then the route's path-id rule); LiteLLM spec - API routes (the
// id is PathLiteLLMId: 1-128 characters, a LiteLLM id: letters, digits and
// @ . _ + : -); RS2 (Reset spend / Reset budget: internal-admin and
// internal-org-admin yes, the auditor no, as the teams tab's canEdit).
//
// Contract (new file app/dashboard/manage/litellm/[tab]/[id]/page.tsx):
//   default async Server Component, props
//   { params: Promise<{ tab: string; id: string }> }.
//   1. managementAccessFor(session).litellm false -> notFound().
//   2. tab !== "teams" -> notFound().
//   3. id: parsePageIdParam(id) null, or not a LiteLLM id (PathLiteLLMId:
//      the route's schema) -> notFound().
//   4. proxyTeamExists(litellmTeamId) false -> notFound(). `proxyTeamExists`
//      is a new server-only function in lib/litellm/proxy-team-exists.ts
//      ({ (litellmTeamId: string): Promise<boolean> }): true when the team
//      exists (the existing getTeam read; no new gateway operation), false on
//      a LiteLLM 404. Chosen by the test engineer: a page cannot learn an
//      unknown id from a client panel (the panel's own boundary would swallow
//      notFound()), so the server page asks.
//   5. Renders <ProxyTeamPageContent litellmTeamId canReset /> with the
//      decoded id and canReset true for internal-admin and internal-org-admin
//      (litellmPanelCapabilities(roles).editTeamLinks), false for the auditor.
const auth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => auth() }));
const loadViewer = vi.fn();
vi.mock("@/lib/auth/settings-access", () => ({
  loadSettingsAccessViewer: (session: unknown) => loadViewer(session),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/manage-access", async () => {
  const mod = await import("@/test/fakes/manage-access-fake");
  return mod.fakeManageAccess;
});
const exists = vi.fn();
vi.mock("@/lib/litellm/proxy-team-exists", () => ({
  proxyTeamExists: (id: string) => exists(id),
}));
const userExists = vi.fn();
vi.mock("@/lib/litellm/proxy-user-exists", () => ({
  proxyUserExists: (id: string) => userExists(id),
}));
vi.mock("@/components/litellm/proxy-user/ProxyUserPageContent", () => ({
  ProxyUserPageContent: (props: {
    litellmUserId: string;
    canWrite: boolean;
    ownOid: string | null;
    name?: string | null;
  }) => (
    <div
      data-testid="user-page"
      data-name={props.name ?? undefined}
      data-id={props.litellmUserId}
      data-write={String(props.canWrite)}
      data-own={props.ownOid ?? ""}
    />
  ),
}));
vi.mock("@/components/litellm/proxy-team/ProxyTeamPageContent", () => ({
  ProxyTeamPageContent: (props: {
    litellmTeamId: string;
    canReset: boolean;
    name?: string | null;
  }) => (
    <div
      data-testid="team-page"
      data-name={props.name ?? undefined}
      data-id={props.litellmTeamId}
      data-reset={String(props.canReset)}
    />
  ),
}));

import {
  resetManageAccess,
  setManageAccess,
} from "@/test/fakes/manage-access-fake";

import LiteLLMTeamPage from "./page";

afterEach(() => {
  vi.clearAllMocks();
  resetManageAccess();
});

function as(roles: string[]) {
  auth.mockResolvedValue({ user: { oid: "oid-1", roles } });
  loadViewer.mockResolvedValue({ roles, authMethod: "entra", adminScopes: [] });
  exists.mockResolvedValue({ exists: true, name: null });
  userExists.mockResolvedValue({ exists: true, name: null });
}
const open = (id: string, tab = "teams") =>
  LiteLLMTeamPage({ params: Promise.resolve({ tab, id }) });

describe("LiteLLM team page (/dashboard/manage/litellm/teams/[id]; T-LP4)", () => {
  it("is a Server Component (Rule 60.7)", () => {
    const source = readFileSync(
      resolve(import.meta.dirname, "page.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/^\s*["']use client["']/m);
  });

  // RS2 / LD24: Reset controls follow the teams tab's canEdit. The three
  // reading roles open the page (security matrix, complete).
  it.each([
    ["internal-admin", "true"],
    ["internal-org-admin", "true"],
    ["internal-auditor", "false"],
  ])("%s opens the page; canReset = %s", async (role, canReset) => {
    as([role]);
    render(await open("ll-team-1"));
    const page = screen.getByTestId("team-page");
    expect(page).toHaveAttribute("data-id", "ll-team-1");
    expect(page).toHaveAttribute("data-reset", canReset);
  });

  it("T-LP4: a lead or a user (no litellm flag) gets the missing page, and no team lookup is made", async () => {
    setManageAccess({ litellm: false });
    as(["internal-viewer"]);
    await expect(open("ll-team-1")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(exists).not.toHaveBeenCalled();
  });

  it("an unauthenticated caller gets the missing page, and no team lookup is made", async () => {
    setManageAccess({ litellm: false });
    auth.mockResolvedValue(null);
    loadViewer.mockResolvedValue(undefined);
    await expect(open("ll-team-1")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(exists).not.toHaveBeenCalled();
  });

  it.each(["organisation", "nope", "Teams", "Users", ""])(
    "the tab must be 'teams' or 'users': %j is the missing page, even for an admin",
    async (tab) => {
      as(["internal-admin"]);
      await expect(open("ll-team-1", tab)).rejects.toThrow("NEXT_NOT_FOUND");
    },
  );

  // Rule 10.3 / Access Control MI-D2: an out-of-scope caller gets the same
  // missing page for an existing and a missing id, and the existence check
  // (a LiteLLM call) is never reached for them.
  it.each([
    ["team-scope lead", "internal-viewer"],
    ["department-scope lead", "internal-viewer"],
    ["member", "internal-viewer"],
  ])(
    "T-LP4: a %s gets notFound() for an existing and a missing id, with no existence check",
    async (_name, role) => {
      for (const found of [true, false]) {
        setManageAccess({ litellm: false });
        as([role]);
        exists.mockResolvedValue({ exists: found, name: null });
        await expect(open("ll-team-1")).rejects.toThrow("NEXT_NOT_FOUND");
      }
      expect(exists).not.toHaveBeenCalled();
    },
  );

  it.each(["internal-admin", "internal-org-admin", "internal-auditor"])(
    "T-LP4 / LD19: %s still sees the page when the existence check reports an outage (true)",
    async (role) => {
      as([role]);
      exists.mockResolvedValue({ exists: true, name: null });
      render(await open("ll-team-1"));
      expect(screen.getByTestId("team-page")).toHaveAttribute(
        "data-id",
        "ll-team-1",
      );
    },
  );

  it("T-LP4: an unknown team id is the missing page", async () => {
    as(["internal-admin"]);
    exists.mockResolvedValue({ exists: false, name: null });
    await expect(open("ll-unknown")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(exists).toHaveBeenCalledWith("ll-unknown");
  });

  // The id is percent-encoded in a page param (parsePageIdParam): decoded once.
  it("decodes the id once before the lookup and the content", async () => {
    as(["internal-admin"]);
    render(await open("ll%3Ateam-1"));
    expect(exists).toHaveBeenCalledWith("ll:team-1");
    expect(screen.getByTestId("team-page")).toHaveAttribute(
      "data-id",
      "ll:team-1",
    );
  });

  // Boundary matrix (path-id rule: 1-128 chars, no control characters; and a
  // LiteLLM id): refused before any lookup. "a%2520b" decodes once to
  // "a%20b", which is not a LiteLLM id; a second decode ("a b") never happens.
  it.each([
    ["empty", ""],
    ["a control character", "ll%01x"],
    ["a malformed escape", "%E0%A4%A"],
    ["a path traversal", "..%2F..%2Fadmin"],
    ["a slash", "a%2Fb"],
    ["a space", "a%20b"],
    ["a doubly-encoded id", "a%2520b"],
    ["129 characters", "a".repeat(129)],
  ])(
    "an invalid id (%s) is the missing page, with no lookup",
    async (_n, id) => {
      as(["internal-admin"]);
      await expect(open(id)).rejects.toThrow("NEXT_NOT_FOUND");
      expect(exists).not.toHaveBeenCalled();
    },
  );

  it("accepts a 128-character id", async () => {
    as(["internal-admin"]);
    const id = "a".repeat(128);
    render(await open(id));
    expect(screen.getByTestId("team-page")).toHaveAttribute("data-id", id);
  });
});

// Sources: Design System - LiteLLM user page (unit LP2, user, 2026-11-25;
// D-R3-8, D-R3-9), T-LP8: "/dashboard/manage/litellm/users/[litellmUserId],
// for the same three roles; an unknown id and a lead get the missing page";
// Access Control MI-D2 / Rule 10.3 / 60.10 (hidden means absent, authorized
// per request, the existence check never reached by an out-of-scope caller);
// LiteLLM spec - API routes (path id is PathLiteLLMId); RS2 / LD24 (Reset and
// Link / Unlink: internal-admin and internal-org-admin yes, the auditor no).
//
// Contract (extend app/dashboard/manage/litellm/[tab]/[id]/page.tsx): tab
// "users" runs the same gates as "teams" (litellm flag, decoded
// PathLiteLLMId, viewer), then proxyUserExists(litellmUserId) (new server-only
// function in lib/litellm/proxy-user-exists.ts, the existing getUser read, the
// same outcomes as proxyTeamExists: true where no call may be made or on an
// outage, false only on a LiteLLM 404), then renders <ProxyUserPageContent
// litellmUserId canWrite ownOid /> with canWrite = litellmPanelCapabilities(
// roles).editTeamLinks and ownOid = session.user.oid. The teams branch is
// unchanged; "users" never asks proxyTeamExists, "teams" never asks
// proxyUserExists.
describe("LiteLLM user page (/dashboard/manage/litellm/users/[id]; T-LP8)", () => {
  const openUser = (id: string) => open(id, "users");

  it.each([
    ["internal-admin", "true"],
    ["internal-org-admin", "true"],
    ["internal-auditor", "false"],
  ])("%s opens the page; canWrite = %s", async (role, canWrite) => {
    as([role]);
    render(await openUser("ll-ada"));
    const page = screen.getByTestId("user-page");
    expect(page).toHaveAttribute("data-id", "ll-ada");
    expect(page).toHaveAttribute("data-write", canWrite);
    expect(page).toHaveAttribute("data-own", "oid-1");
    expect(exists).not.toHaveBeenCalled();
  });

  it("T-LP8: a lead or a user (no litellm flag) gets the missing page, and no user lookup is made", async () => {
    setManageAccess({ litellm: false });
    as(["internal-viewer"]);
    await expect(openUser("ll-ada")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(userExists).not.toHaveBeenCalled();
  });

  it("an unauthenticated caller gets the missing page, and no user lookup is made", async () => {
    setManageAccess({ litellm: false });
    auth.mockResolvedValue(null);
    loadViewer.mockResolvedValue(undefined);
    await expect(openUser("ll-ada")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(userExists).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "T-LP8 / MI-D2: an out-of-scope caller gets notFound() for an existing (%s) and a missing id alike, with no existence check",
    async (found) => {
      setManageAccess({ litellm: false });
      as(["internal-viewer"]);
      userExists.mockResolvedValue({ exists: found, name: null });
      await expect(openUser("ll-ada")).rejects.toThrow("NEXT_NOT_FOUND");
      expect(userExists).not.toHaveBeenCalled();
    },
  );

  it("T-LP8: an unknown user id is the missing page", async () => {
    as(["internal-admin"]);
    userExists.mockResolvedValue({ exists: false, name: null });
    await expect(openUser("ll-unknown")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(userExists).toHaveBeenCalledWith("ll-unknown");
  });

  it("T-LP8 / LD19: the page still shows when the existence check reports an outage (true)", async () => {
    as(["internal-auditor"]);
    userExists.mockResolvedValue({ exists: true, name: null });
    render(await openUser("ll-ada"));
    expect(screen.getByTestId("user-page")).toBeInTheDocument();
  });

  it("decodes the id once before the lookup and the content (an email-shaped id with @ and +)", async () => {
    as(["internal-admin"]);
    render(await openUser("ada%2Bx%40example.test"));
    expect(userExists).toHaveBeenCalledWith("ada+x@example.test");
    expect(screen.getByTestId("user-page")).toHaveAttribute(
      "data-id",
      "ada+x@example.test",
    );
  });

  it.each([
    ["empty", ""],
    ["a control character", "ll%01x"],
    ["a malformed escape", "%E0%A4%A"],
    ["a path traversal", "..%2F..%2Fadmin"],
    ["a slash", "a%2Fb"],
    ["a space", "a%20b"],
    ["a doubly-encoded id", "a%2520b"],
    ["129 characters", "a".repeat(129)],
  ])(
    "an invalid id (%s) is the missing page, with no lookup",
    async (_n, id) => {
      as(["internal-admin"]);
      await expect(openUser(id)).rejects.toThrow("NEXT_NOT_FOUND");
      expect(userExists).not.toHaveBeenCalled();
    },
  );

  it("accepts a 128-character id", async () => {
    as(["internal-admin"]);
    const id = "a".repeat(128);
    render(await openUser(id));
    expect(screen.getByTestId("user-page")).toHaveAttribute("data-id", id);
  });
});

// Source: Design System - LiteLLM team page and LiteLLM user page, "Name and
// spend over time (unit LP3)", T-LP13, T-LP14: the page passes the name its
// existence check resolved to the page content (the breadcrumb's label is
// `name ?? id`, decided in the content); the name is absent where the check
// had none; the authorization lines and their order are unchanged (the
// existence check is still never reached by a caller without access).
describe("LiteLLM detail page passes the resolved name (T-LP13, T-LP14)", () => {
  it.each(["internal-admin", "internal-org-admin", "internal-auditor"])(
    "T-LP14: %s - the team page content gets the alias the check returned",
    async (role) => {
      as([role]);
      exists.mockResolvedValue({ exists: true, name: "Alpha" });
      render(await open("ll-team-1"));
      expect(screen.getByTestId("team-page")).toHaveAttribute(
        "data-name",
        "Alpha",
      );
    },
  );

  it.each(["internal-admin", "internal-org-admin", "internal-auditor"])(
    "T-LP13: %s - the user page content gets the name the check returned",
    async (role) => {
      as([role]);
      userExists.mockResolvedValue({ exists: true, name: "Ada L." });
      render(await open("ll-ada", "users"));
      expect(screen.getByTestId("user-page")).toHaveAttribute(
        "data-name",
        "Ada L.",
      );
    },
  );

  it("T-LP13, T-LP14: no name from the check means no name for the content (the id is shown)", async () => {
    as(["internal-admin"]);
    render(await open("ll-team-1"));
    expect(screen.getByTestId("team-page")).not.toHaveAttribute("data-name");
    render(await open("ll-ada", "users"));
    expect(screen.getByTestId("user-page")).not.toHaveAttribute("data-name");
  });

  it("T-LP13: a name that looks like markup reaches the content as the same string", async () => {
    as(["internal-admin"]);
    userExists.mockResolvedValue({ exists: true, name: "<b>x</b>" });
    render(await open("ll-ada", "users"));
    expect(screen.getByTestId("user-page")).toHaveAttribute(
      "data-name",
      "<b>x</b>",
    );
  });

  it("T-LP13: an unknown id is still the missing page, whatever name came back", async () => {
    as(["internal-admin"]);
    userExists.mockResolvedValue({ exists: false, name: "Ghost" });
    await expect(open("ll-ghost", "users")).rejects.toThrow("NEXT_NOT_FOUND");
    exists.mockResolvedValue({ exists: false, name: "Ghost" });
    await expect(open("ll-ghost")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("the check for each tab is made once, with the decoded id, and only for that tab", async () => {
    as(["internal-admin"]);
    await open("ll-team-1");
    expect(exists).toHaveBeenCalledTimes(1);
    expect(userExists).not.toHaveBeenCalled();
    await open("ll-ada", "users");
    expect(userExists).toHaveBeenCalledTimes(1);
    expect(exists).toHaveBeenCalledTimes(1);
  });
});
