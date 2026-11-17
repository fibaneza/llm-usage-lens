import "server-only";

import { trace } from "@opentelemetry/api";
import type { Session } from "next-auth";

import { env } from "@/env";
import { accessCapabilities } from "@/components/settings/access/capabilities";
import { globalRolesOf, resolveScope } from "@/lib/auth/policy";
import {
  INTERNAL_ADMIN_ROLE,
  INTERNAL_AUDITOR_ROLE,
  INTERNAL_ORG_ADMIN_ROLE,
} from "@/lib/auth/roles";
import { loadAuthorization } from "@/lib/data/access/authorization";

// Source: slice B2 decision B2-1; Access Control - Navigation and landing by
// role and Enforcement; Rule 10.3, 50.3. The one server-side answer to "which
// Management pages may this caller open": the nav and every Management page
// gate on it. Roles come from the claim plus stored grants and scopes are
// resolved live (a suspended SSO scope grants nothing). Never cached (Rule
// 60.10); any read failure closes every flag.
export type ManagementAccess = {
  global: boolean;
  team: boolean;
  organisation: boolean;
  users: boolean;
  audit: { app: boolean; gateway: boolean };
  settings: boolean;
};

const CLOSED: ManagementAccess = {
  global: false,
  team: false,
  organisation: false,
  users: false,
  audit: { app: false, gateway: false },
  settings: false,
};

export async function managementAccessFor(
  session: Session | null,
): Promise<ManagementAccess> {
  if (!session) return CLOSED;
  try {
    const input = await loadAuthorization({
      appEnv: env.APP_ENV === "prod" ? "prod" : "dev",
      session,
      teamIds: [],
      departmentIds: [],
    });
    const roles = globalRolesOf(session, input.appEnv, input.roleGrants) ?? [];
    const scope = resolveScope({
      ...input,
      session,
      adminScopes: input.adminScopes ?? [],
    });

    const admin = roles.includes(INTERNAL_ADMIN_ROLE);
    const auditor = roles.includes(INTERNAL_AUDITOR_ROLE);
    const reader = admin || auditor || roles.includes(INTERNAL_ORG_ADMIN_ROLE);
    const lead = scope.teamScopes.size > 0 || scope.departmentScopes.size > 0;

    return {
      global: reader,
      team: reader || lead,
      organisation: reader,
      users: reader,
      audit: {
        app: accessCapabilities({ roles, adminScopes: [] }).auditLog,
        gateway: admin || auditor,
      },
      settings: reader,
    };
  } catch (error) {
    trace
      .getActiveSpan()
      ?.recordException(
        error instanceof Error
          ? error
          : new Error("management access read failed"),
      );
    return CLOSED;
  }
}
