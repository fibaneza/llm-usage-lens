import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Source: LiteLLM spec -- Page and Settings (audit section: Admin, Auditor
// only); Rules 10.3, 50.3, 60.7. The server resolves the role and passes it
// down; the route handlers enforce it again.
const auth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => auth() }));
vi.mock("@/components/litellm/LiteLLMContent", () => ({
  LiteLLMContent: (props: { canViewAudit: boolean }) => (
    <div data-testid="content">{String(props.canViewAudit)}</div>
  ),
}));

import LiteLLMPage from "./page";

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

  it("denies the audit section without a session", async () => {
    auth.mockResolvedValue(null);
    render(await LiteLLMPage());
    expect(screen.getByTestId("content")).toHaveTextContent("false");
  });
});
