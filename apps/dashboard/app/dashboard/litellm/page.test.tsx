import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Source: LiteLLM spec -- Page and Settings (audit section: Admin, Auditor
// only) and Views by role (L3b: the tab set per role; a tab the caller cannot
// use is not rendered); Rules 10.3, 50.3, 60.7. The server resolves the role and passes it
// down; the route handlers enforce it again.
const auth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => auth() }));
// The page resolves roles through lib/litellm/route-guard (claim plus stored
// role grants, Rule 50.4); only the DynamoDB read underneath is replaced.
vi.mock("server-only", () => ({}));
const loadAuthorization = vi.fn();
vi.mock("@/lib/data/access/authorization", () => ({
  loadAuthorization: (input: unknown) => loadAuthorization(input),
}));
vi.mock("@/env", () => ({
  env: { APP_ENV: "dev", AUTH_ACCESS_MODE: "enforce" },
}));
vi.mock("@/components/litellm/LiteLLMContent", () => ({
  LiteLLMContent: (props: { tabs: string[] }) => (
    <div data-testid="content">{props.tabs.join(",")}</div>
  ),
}));

import LiteLLMPage from "./page";

beforeEach(() => {
  loadAuthorization.mockResolvedValue({ appEnv: "dev", roleGrants: [] });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("LiteLLMPage (/dashboard/litellm)", () => {
  it("is a Server Component (Rule 60.7)", () => {
    const source = readFileSync(
      resolve(import.meta.dirname, "page.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/^\s*["']use client["']/m);
  });

  // L3b contract: the server computes `tabs` (ids my-usage | team |
  // organisation | users | audit, in this order) and passes them to
  // <LiteLLMContent tabs={...} />. Team is a ceiling; the client also needs
  // me.teams non-empty.
  it.each([
    ["internal-admin", "my-usage,team,organisation,users,audit"],
    ["internal-auditor", "my-usage,team,organisation,users,audit"],
    ["internal-org-admin", "my-usage,team,organisation,users"],
    ["internal-viewer", "my-usage"],
  ])("tabs for %s are %s (Views by role)", async (role, expected) => {
    auth.mockResolvedValue({ user: { oid: "o", roles: [role] } });
    render(await LiteLLMPage());
    expect(screen.getByTestId("content")).toHaveTextContent(
      new RegExp(`^${expected}$`),
    );
  });

  it("a Lead (team admin scope, no global role) gets My usage, Team and Users (Views by role)", async () => {
    auth.mockResolvedValue({ user: { oid: "o", roles: ["internal-viewer"] } });
    loadAuthorization.mockResolvedValue({
      appEnv: "dev",
      roleGrants: [],
      adminScopes: [{ scopeType: "team", scopeId: "t1" }],
    });
    render(await LiteLLMPage());
    expect(screen.getByTestId("content")).toHaveTextContent(
      /^my-usage,team,users$/,
    );
  });

  // Source: Access Control spec - "Enforcement" (a suspended SSO admin scope,
  // groupsOverage, grants nothing; the routes drop it) and LiteLLM spec -
  // Views by role: the tab set must use the same live-scope resolution as
  // the routes, else the tabs show and every call answers 403.
  it.each([
    ["suspended (sso scope, groupsOverage)", "sso", true, "my-usage"],
    [
      "live sso scope without groupsOverage",
      "sso",
      false,
      "my-usage,team,users",
    ],
    ["manual scope is never suspended", "manual", true, "my-usage,team,users"],
  ])(
    "a Lead whose only admin scope is %s gets the expected tabs",
    async (_name, source, groupsOverage, expected) => {
      auth.mockResolvedValue({
        user: { oid: "o", roles: ["internal-viewer"] },
      });
      loadAuthorization.mockResolvedValue({
        appEnv: "dev",
        roleGrants: [],
        identity: { groupsOverage },
        adminScopes: [{ source, scopeType: "team", scopeId: "t1" }],
      });
      render(await LiteLLMPage());
      expect(screen.getByTestId("content")).toHaveTextContent(
        new RegExp(`^${expected}$`),
      );
    },
  );

  it("a stored internal-admin grant opens every tab for a claim without the role (Rule 50.4)", async () => {
    auth.mockResolvedValue({ user: { oid: "o", roles: ["internal-viewer"] } });
    loadAuthorization.mockResolvedValue({
      appEnv: "dev",
      roleGrants: [{ role: "internal-admin" }],
    });
    render(await LiteLLMPage());
    expect(screen.getByTestId("content")).toHaveTextContent(/audit/);
  });

  it("gives only My usage without a session", async () => {
    auth.mockResolvedValue(null);
    render(await LiteLLMPage());
    expect(screen.getByTestId("content")).toHaveTextContent(/^my-usage$/);
  });
});
