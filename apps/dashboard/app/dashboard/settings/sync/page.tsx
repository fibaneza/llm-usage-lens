import { notFound } from "next/navigation";

import { auth } from "@/auth";
import { SyncTab } from "@/components/settings/SyncTab";
import { getAppConfig } from "@/lib/config/app-config";
import { resolveDailyRollupDays } from "@/lib/config/resolvers";
import { managementAccessFor } from "@/lib/manage-access";

export default async function SyncPage() {
  if (!(await managementAccessFor(await auth())).settings) notFound();
  const retention = resolveDailyRollupDays(getAppConfig());
  return (
    <SyncTab
      retentionDays={retention.value}
      retentionSource={retention.source}
    />
  );
}
