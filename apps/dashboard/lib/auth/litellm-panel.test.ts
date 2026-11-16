import { describe, expect, it } from "vitest";

import { litellmPanelCapabilities } from "./litellm-panel";
import {
  ADMIN_ROLE,
  INTERNAL_ADMIN_ROLE,
  INTERNAL_AUDITOR_ROLE,
  INTERNAL_ORG_ADMIN_ROLE,
  INTERNAL_VIEWER_ROLE,
} from "./roles";

// Source: docs/specs/2026-11-10-litellm.md LD24 (org-admin edits Guardrails and
// Team links, Connection stays Admin only; Auditor read-only), LT22, and
// implementation-phases L3d2; Rule 50.3 (role names come from lib/auth/roles).
// Fail closed: any role outside the three LiteLLM-capable globals sees nothing.
const NONE = {
  visible: false,
  editConnection: false,
  editGuardrails: false,
  editTeamLinks: false,
};

describe("litellmPanelCapabilities (LD24)", () => {
  it.each([
    [
      "internal-admin",
      [INTERNAL_ADMIN_ROLE],
      {
        visible: true,
        editConnection: true,
        editGuardrails: true,
        editTeamLinks: true,
      },
    ],
    [
      "internal-org-admin",
      [INTERNAL_ORG_ADMIN_ROLE],
      {
        visible: true,
        editConnection: false,
        editGuardrails: true,
        editTeamLinks: true,
      },
    ],
    [
      "internal-auditor",
      [INTERNAL_AUDITOR_ROLE],
      {
        visible: true,
        editConnection: false,
        editGuardrails: false,
        editTeamLinks: false,
      },
    ],
    ["internal-viewer", [INTERNAL_VIEWER_ROLE], NONE],
    ["no roles", [], NONE],
    ["unknown strings", ["Lead", "root", ""], NONE],
    ["legacy Admin alias (fail closed)", [ADMIN_ROLE], NONE],
  ])("%s", (_name, roles, expected) => {
    expect(litellmPanelCapabilities(roles)).toEqual(expected);
  });

  it("takes the union of several roles (admin + auditor = admin)", () => {
    expect(
      litellmPanelCapabilities([INTERNAL_AUDITOR_ROLE, INTERNAL_ADMIN_ROLE]),
    ).toEqual({
      visible: true,
      editConnection: true,
      editGuardrails: true,
      editTeamLinks: true,
    });
  });

  it("org-admin + auditor never gains connection edit", () => {
    expect(
      litellmPanelCapabilities([INTERNAL_AUDITOR_ROLE, INTERNAL_ORG_ADMIN_ROLE])
        .editConnection,
    ).toBe(false);
  });
});
