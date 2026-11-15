import { auth } from "@/auth";
import { SettingsContent } from "@/components/settings/SettingsContent";
import { INTERNAL_ADMIN_ROLE, hasAdminRole } from "@/lib/auth/roles";
import { loadSettingsAccessViewer } from "@/lib/auth/settings-access";

import {
  stepUpWithCredentials,
  stepUpWithDevLogin,
  stepUpWithEntra,
} from "./step-up-actions";

// The Admin role (claim plus in-app grants) and the access viewer are resolved
// on the server and passed down (Rule 10.3, 50.3); the write Route Handlers enforce them again.
export default async function SettingsPage() {
  const session = await auth();
  const viewer = await loadSettingsAccessViewer(session);
  return (
    <SettingsContent
      isAdmin={
        viewer
          ? viewer.roles.includes(INTERNAL_ADMIN_ROLE)
          : hasAdminRole(session)
      }
      {...(viewer
        ? {
            access: {
              viewer,
              stepUp: {
                entra: stepUpWithEntra,
                credentials: stepUpWithCredentials,
                devLogin: stepUpWithDevLogin,
              },
            },
          }
        : {})}
    />
  );
}
