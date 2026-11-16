import {
  INTERNAL_ADMIN_ROLE,
  INTERNAL_AUDITOR_ROLE,
  INTERNAL_ORG_ADMIN_ROLE,
} from "./roles";

// Source: docs/specs/2026-11-10-litellm.md LD24 (org-admin edits Guardrails and
// Team links, Connection stays Admin only; Auditor read-only), LT22; Rule 50.3.
// Pure so the Settings client tree can import it. Fail closed: any role outside
// these three (legacy `Admin` included) sees no LiteLLM section.
export type LiteLLMPanelCapabilities = {
  editConnection: boolean;
  editGuardrails: boolean;
  editTeamLinks: boolean;
};

export function litellmPanelCapabilities(
  roles: readonly string[],
): LiteLLMPanelCapabilities & { visible: boolean } {
  const admin = roles.includes(INTERNAL_ADMIN_ROLE);
  const orgAdmin = roles.includes(INTERNAL_ORG_ADMIN_ROLE);
  return {
    visible: admin || orgAdmin || roles.includes(INTERNAL_AUDITOR_ROLE),
    editConnection: admin,
    editGuardrails: admin || orgAdmin,
    editTeamLinks: admin || orgAdmin,
  };
}
