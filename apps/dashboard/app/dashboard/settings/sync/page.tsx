import { SyncTab } from "@/components/settings/SyncTab";
import { getAppConfig } from "@/lib/config/app-config";
import { resolveDailyRollupDays } from "@/lib/config/resolvers";

export default function SyncPage() {
  const retention = resolveDailyRollupDays(getAppConfig());
  return (
    <SyncTab
      retentionDays={retention.value}
      retentionSource={retention.source}
    />
  );
}
