import { auth } from "@/auth";
import { SettingsContent } from "@/components/settings/SettingsContent";
import { hasAdminRole } from "@/lib/auth/roles";

// The Admin role is resolved on the server and passed down (Rule 10.3, 50.3);
// the write Route Handlers enforce it again.
export default async function SettingsPage() {
  const session = await auth();
  return <SettingsContent isAdmin={hasAdminRole(session)} />;
}
