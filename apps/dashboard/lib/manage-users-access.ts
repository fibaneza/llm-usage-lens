import "server-only";

import type { Session } from "next-auth";

import type { AccessViewer } from "@/components/settings/access/types";
import { env } from "@/env";
import { addUserStepsFor, type AddUserSteps } from "@/lib/auth/add-user-steps";
import { buildAccessViewer } from "@/lib/auth/settings-access";
import { globalRolesOf } from "@/lib/auth/policy";
import { loadAuthorization } from "@/lib/data/access/authorization";

// Source: Design System - Management improvements, Users (D15) and User link
// states (D16). Read per request, never cached (Rule 60.10); a read failure
// closes every control (the page itself is gated by managementAccessFor).
export type UsersPageAccess = {
  steps: AddUserSteps;
  ownOid: string;
  authMethod: AccessViewer["authMethod"];
  authTime?: number;
};

export async function usersPageAccessFor(
  session: Session | null,
  entra: boolean,
): Promise<UsersPageAccess | null> {
  const viewer = buildAccessViewer(session, []);
  const oid = session?.user?.oid;
  if (viewer === null || typeof oid !== "string") return null;
  const input = await loadAuthorization({
    appEnv: env.APP_ENV === "prod" ? "prod" : "dev",
    session,
    teamIds: [],
    departmentIds: [],
  });
  const roles = globalRolesOf(session, input.appEnv, input.roleGrants) ?? [];
  return {
    steps: addUserStepsFor({ roles, entra }),
    ownOid: oid,
    authMethod: viewer.authMethod,
    ...(viewer.authTime === undefined ? {} : { authTime: viewer.authTime }),
  };
}
