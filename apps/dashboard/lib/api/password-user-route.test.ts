import { describe, expect, it, vi } from "vitest";

// Source: docs/specs/2026-11-10-access-control.md - T42 (a password setup link
// leaves the prefix or trusts a forged host) and "Password users" (the link
// host is the request Host, never x-forwarded-host; the token stays in the
// fragment, T24); Platform spec - Base path: BP-D3 / BP-D13 (setupLink() is a
// withBasePath site). Test T4 of the BP brief.
// setupLink is pure; the route plumbing around it pulls in Auth.js and the
// data layer, which are not under test here.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/data/access/password-users", () => ({
  getPasswordUserListItem: vi.fn(),
}));

async function loadSetupLink(prefix: string) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_BASE_PATH", prefix);
  return (await import("./password-user-route")).setupLink;
}

const request = (headers: Record<string, string>) =>
  new Request("http://internal.invalid/api/password-users", { headers });

describe("setupLink (T42)", () => {
  it("builds https://<Host>/account/setup#<token> with no base path", async () => {
    const setupLink = await loadSetupLink("");
    expect(setupLink(request({ host: "dash.example.test" }), "tok")).toBe(
      "https://dash.example.test/account/setup#tok",
    );
  });

  it("carries the base path before /account/setup and keeps the token in the fragment", async () => {
    const setupLink = await loadSetupLink("/llm-lens");
    expect(setupLink(request({ host: "dash.example.test" }), "tok")).toBe(
      "https://dash.example.test/llm-lens/account/setup#tok",
    );
  });

  it("still uses the request Host, never x-forwarded-host, under a prefix", async () => {
    const setupLink = await loadSetupLink("/llm-lens");
    const link = setupLink(
      request({ host: "dash.example.test", "x-forwarded-host": "evil.test" }),
      "tok",
    );
    expect(link).toContain("dash.example.test");
    expect(link).not.toContain("evil.test");
  });
});
