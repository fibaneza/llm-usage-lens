import { AccountRegistry } from "@/components/settings/AccountRegistry";
import { SettingsSection } from "@/components/settings/SettingsSection";

// AWS accounts tab (Design System "Settings Page", unit D). `isAdmin` is
// resolved on the server (Rule 10.3, 50.3); the write routes enforce it again.
export function AccountsTab({ isAdmin }: { isAdmin: boolean }) {
  return (
    <SettingsSection heading="Account registry" title="the account registry">
      <AccountRegistry isAdmin={isAdmin} />
    </SettingsSection>
  );
}
