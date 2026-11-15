import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Source: LiteLLM spec -- Page and Settings (audit section: Admin, Auditor
// only); Rules 10.3, 50.3, 60.7. The server resolves the role and passes it
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
  LiteLLMContent: (props: { canViewAudit: boolean }) => (
    <div data-testid="content">{String(props.canViewAudit)}</div>
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

  it.each([
    ["internal-admin", "true"],
    ["internal-auditor", "true"],
    ["internal-org-admin", "false"],
    ["internal-viewer", "false"],
  ])("canViewAudit for %s is %s", async (role, expected) => {
    auth.mockResolvedValue({ user: { oid: "o", roles: [role] } });
    render(await LiteLLMPage());
    expect(screen.getByTestId("content")).toHaveTextContent(expected);
  });

  it("a stored internal-admin grant opens the audit section for a claim without the role (Rule 50.4)", async () => {
    auth.mockResolvedValue({ user: { oid: "o", roles: ["internal-viewer"] } });
    loadAuthorization.mockResolvedValue({
      appEnv: "dev",
      roleGrants: [{ role: "internal-admin" }],
    });
    render(await LiteLLMPage());
    expect(screen.getByTestId("content")).toHaveTextContent("true");
  });

  it("denies the audit section without a session", async () => {
    auth.mockResolvedValue(null);
    render(await LiteLLMPage());
    expect(screen.getByTestId("content")).toHaveTextContent("false");
  });
});
