import {
  accessCapabilities,
  type AccessCapabilities,
} from "@/components/settings/access/capabilities";
import { litellmPanelCapabilities } from "@/lib/auth/litellm-panel";

// Source: Design System "Settings Page" (unit D, 2026-11-16): the tab table
// ("Visible to"), the Access sub-tab table (segments and section slugs) and
// "a tab the caller cannot use is not rendered"; LiteLLM spec LD24 (the
// LiteLLM tab); slice B2 (B2-3): the Audit tab left Settings for Management ->
// Audit. The one place the tab set is decided; the write routes
// enforce the permission matrix again (Rule 10.3).
export const SETTINGS_BASE_PATH = "/dashboard/settings";

export type SettingsTabId = "accounts" | "sync" | "litellm" | "access";
export type AccessSubTabId =
  | "people"
  | "visibility"
  | "roles"
  | "identities"
  | "sign-in";
export type LiteLLMSubTabId =
  | "connection"
  | "guardrails"
  | "team-links"
  | "users";
export type AccessSectionSlug =
  | "members"
  | "team-admins"
  | "pending-access"
  | "visibility"
  | "group-mappings"
  | "role-grants"
  | "identity-links"
  | "identity-mapping"
  | "password-users"
  | "per-user-approval"
  | "audit-log"
  | "access-review";

export type AccessSubTab = {
  id: AccessSubTabId | LiteLLMSubTabId;
  label: string;
  href: string;
  sections: readonly AccessSectionSlug[];
};

export type SettingsTab = {
  id: SettingsTabId;
  label: string;
  href: string;
  subTabs: readonly AccessSubTab[];
  sections: readonly AccessSectionSlug[];
};

type ViewerInput = {
  roles: readonly string[];
  adminScopes: readonly {
    readonly scopeType: "team" | "department";
    readonly scopeId: string;
  }[];
};

const SUB_TABS: readonly {
  id: AccessSubTabId;
  label: string;
  sections: readonly AccessSectionSlug[];
}[] = [
  {
    id: "people",
    label: "People",
    sections: ["members", "team-admins", "pending-access"],
  },
  { id: "visibility", label: "Visibility", sections: ["visibility"] },
  {
    id: "roles",
    label: "Roles and mapping",
    sections: ["group-mappings", "role-grants"],
  },
  {
    id: "identities",
    label: "Identities",
    sections: ["identity-links", "identity-mapping"],
  },
  {
    id: "sign-in",
    label: "Sign-in",
    sections: ["password-users", "per-user-approval"],
  },
];

export function isSectionVisible(
  slug: AccessSectionSlug,
  capabilities: AccessCapabilities,
): boolean {
  switch (slug) {
    case "members":
      return capabilities.members;
    case "team-admins":
      return capabilities.teamAdmins;
    case "pending-access":
      return capabilities.pendingAccess;
    case "visibility":
      return capabilities.visibility;
    case "group-mappings":
      return capabilities.groupMappings !== "none";
    case "role-grants":
      return capabilities.roleGrants !== "none";
    case "identity-links":
    case "identity-mapping":
      return capabilities.identityLinks !== "none";
    case "password-users":
      return capabilities.passwordUsers !== "none";
    case "per-user-approval":
      return capabilities.perUserApproval !== "none";
    case "audit-log":
      return capabilities.auditLog;
    case "access-review":
      return capabilities.accessReview;
  }
}

// Design System "Settings Page" - LiteLLM sub-tabs (unit A2, 2026-11-17): each
// is a route segment; visibility follows litellmPanelCapabilities.
const LITELLM_SUB_TABS: readonly { id: LiteLLMSubTabId; label: string }[] = [
  { id: "connection", label: "Connection" },
  { id: "guardrails", label: "Guardrails" },
  { id: "team-links", label: "Team links" },
  { id: "users", label: "Users" },
];

function tab(
  id: SettingsTabId,
  label: string,
  extra: Partial<Pick<SettingsTab, "subTabs" | "sections">> = {},
): SettingsTab {
  return {
    id,
    label,
    href: `${SETTINGS_BASE_PATH}/${id}`,
    subTabs: [],
    sections: [],
    ...extra,
  };
}

export function settingsTabsFor(
  viewer: ViewerInput | null | undefined,
): SettingsTab[] {
  const tabs: SettingsTab[] = [
    tab("accounts", "AWS accounts"),
    tab("sync", "Sync and data"),
  ];
  if (!viewer) return tabs;

  const capabilities = accessCapabilities(viewer);
  if (litellmPanelCapabilities(viewer.roles).visible) {
    tabs.push(
      tab("litellm", "LiteLLM", {
        subTabs: LITELLM_SUB_TABS.map((sub) => ({
          ...sub,
          href: `${SETTINGS_BASE_PATH}/litellm/${sub.id}`,
          sections: [],
        })),
      }),
    );
  }

  const subTabs = SUB_TABS.flatMap((sub) => {
    const sections = sub.sections.filter((s) =>
      isSectionVisible(s, capabilities),
    );
    return sections.length === 0
      ? []
      : [
          {
            id: sub.id,
            label: sub.label,
            href: `${SETTINGS_BASE_PATH}/access/${sub.id}`,
            sections,
          },
        ];
  });
  if (subTabs.length > 0) tabs.push(tab("access", "Access", { subTabs }));

  return tabs;
}
