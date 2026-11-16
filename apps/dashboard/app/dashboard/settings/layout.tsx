import type { ReactNode } from "react";

import { auth } from "@/auth";
import { SettingsHashResolver } from "@/components/settings/SettingsHashResolver";
import { SettingsTabs } from "@/components/settings/SettingsTabs";
import { loadSettingsAccessViewer } from "@/lib/auth/settings-access";
import { settingsTabsFor } from "@/lib/settings-tabs";

// The tab row shows only the tabs the caller can use (Design System "Settings
// Page"). A layout is not re-run on soft navigation, so every tab page
// authorizes itself again; nothing here is cached (Rule 60.10).
export default async function SettingsLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await auth();
  const tabs = settingsTabsFor(await loadSettingsAccessViewer(session));
  return (
    <div className="flex flex-col gap-6">
      <SettingsTabs tabs={tabs} />
      <SettingsHashResolver tabs={tabs} />
      {children}
    </div>
  );
}
