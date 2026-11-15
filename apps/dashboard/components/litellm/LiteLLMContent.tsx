"use client";

import { AuditSection } from "./AuditSection";
import { LiteLLMSection } from "./LiteLLMSection";
import { MyUsageSection } from "./MyUsageSection";
import { TeamArea } from "./TeamArea";

// LiteLLM page body (LiteLLM spec -- Page and Settings; Design System --
// LiteLLM Page). Read-only in L3. `canViewAudit` comes from the server page;
// the audit route enforces the role again.
export function LiteLLMContent({ canViewAudit }: { canViewAudit: boolean }) {
  return (
    <div className="flex flex-col gap-6">
      <LiteLLMSection title="My usage" reported>
        <MyUsageSection />
      </LiteLLMSection>
      <TeamArea />
      {canViewAudit ? (
        <LiteLLMSection title="LiteLLM audit">
          <AuditSection />
        </LiteLLMSection>
      ) : null}
    </div>
  );
}
