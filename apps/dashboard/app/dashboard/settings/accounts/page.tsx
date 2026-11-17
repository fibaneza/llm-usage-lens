import { notFound } from "next/navigation";

import { auth } from "@/auth";
import { AccountsTab } from "@/components/settings/AccountsTab";
import { INTERNAL_ADMIN_ROLE, hasAdminRole } from "@/lib/auth/roles";
import { loadSettingsAccessViewer } from "@/lib/auth/settings-access";
import { managementAccessFor } from "@/lib/manage-access";

// The Admin role (claim plus in-app grants) is resolved on the server and
// passed down (Rule 10.3, 50.3); the write Route Handlers enforce it again.
export default async function AccountsPage() {
  const session = await auth();
  if (!(await managementAccessFor(session)).settings) notFound();
  const viewer = await loadSettingsAccessViewer(session);
  return (
    <AccountsTab
      isAdmin={
        viewer
          ? viewer.roles.includes(INTERNAL_ADMIN_ROLE)
          : hasAdminRole(session)
      }
    />
  );
}
