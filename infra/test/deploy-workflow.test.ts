// @vitest-environment node
// Source: docs/specs/2026-11-10-access-control.md - "Pre-SSO mode" (D19);
// docs/specs/2026-11-10-platform.md - "Inputs". Text-based structural check;
// the workflow is never executed.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const text = readFileSync(
  resolve(__dirname, "../../.github/workflows/llm-usage-lens-deploy.yml"),
  "utf8",
);

describe("deploy workflow pre-SSO inputs", () => {
  it("passes masterUsername from a repository variable", () => {
    expect(text).toMatch(/\$\{\{\s*vars\.MASTER_USERNAME\s*\}\}/);
    expect(text).toMatch(/-c\s+"masterUsername=/);
  });

  it("does not pass the Entra pair unconditionally", () => {
    const unconditional = text
      .split("\n")
      .filter((l) => /^\s*-c\s+"entra(ClientId|Issuer)=/.test(l));
    expect(unconditional).toEqual([]);
    expect(text).toMatch(/entraClientId=/);
    expect(text).toMatch(/entraIssuer=/);
    expect(text).toMatch(/if \[ -n "\$\{ENTRA_CLIENT_ID\}" \]/);
  });
});
