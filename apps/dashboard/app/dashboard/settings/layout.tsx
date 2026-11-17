import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { auth } from "@/auth";
import { PageHeader } from "@/components/layout/PageHeader";
import { SettingsHashResolver } from "@/components/settings/SettingsHashResolver";
import { SettingsTabs } from "@/components/settings/SettingsTabs";
import { loadSettingsAccessViewer } from "@/lib/auth/settings-access";
import { managementAccessFor } from "@/lib/manage-access";
import { settingsTabsFor } from "@/lib/settings-tabs";

// The tab row shows only the tabs the caller can use (Design System "Settings
// Page"); Settings itself is closed to a lead and a user (slice B2, B2-10). A
// layout is not re-run on soft navigation, so every tab page authorizes itself
// again; nothing here is cached (Rule 60.10). The page h1 stays in the top bar.
export default async function SettingsLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await auth();
  if (!(await managementAccessFor(session)).settings) notFound();
  const tabs = settingsTabsFor(await loadSettingsAccessViewer(session));
  return (
    <div className="flex flex-col gap-6">
      <PageHeader description="Organisation configuration: AWS accounts, sync and data, the LiteLLM gateway and access." />
      <SettingsTabs tabs={tabs} />
      <SettingsHashResolver tabs={tabs} />
      {children}
    </div>
  );
}
