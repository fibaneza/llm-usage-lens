import { DataRetention } from "@/components/settings/DataRetention";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { SyncStatusPanel } from "@/components/settings/SyncStatusPanel";

// Sync and data tab (Design System "Settings Page", unit D). The sync panel
// carries its own boundary.
export function SyncTab() {
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Sync status</h2>
        <SyncStatusPanel />
      </section>
      <SettingsSection
        heading="Data retention"
        title="the data retention policy"
      >
        <DataRetention />
      </SettingsSection>
    </div>
  );
}
