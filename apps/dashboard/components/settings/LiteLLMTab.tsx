import {
  LiteLLMPanel,
  type LiteLLMPanelCapabilities,
} from "@/components/settings/LiteLLMPanel";
import { SettingsSection } from "@/components/settings/SettingsSection";

// LiteLLM tab (Design System "Settings Page", unit D): the panel unchanged.
// Who reaches the tab is decided by lib/settings-tabs and the page.
export function LiteLLMTab({
  capabilities,
}: {
  capabilities: LiteLLMPanelCapabilities;
}) {
  return (
    <SettingsSection heading="LiteLLM" title="the LiteLLM connection">
      <LiteLLMPanel capabilities={capabilities} />
    </SettingsSection>
  );
}
