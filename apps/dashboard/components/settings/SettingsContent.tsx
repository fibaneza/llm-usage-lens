"use client";

import type { ReactNode } from "react";

import { SectionBoundary } from "@/components/display/SectionBoundary";
import { AccessSections } from "@/components/settings/access/AccessSections";
import type {
  AccessViewer,
  StepUpActions,
} from "@/components/settings/access/types";
import { AccountRegistry } from "@/components/settings/AccountRegistry";
import { DataRetention } from "@/components/settings/DataRetention";
import { LiteLLMPanel } from "@/components/settings/LiteLLMPanel";
import { SyncStatusPanel } from "@/components/settings/SyncStatusPanel";
import { Skeleton } from "@/components/ui/skeleton";
import { litellmPanelCapabilities } from "@/lib/auth/litellm-panel";
import { INTERNAL_ADMIN_ROLE } from "@/lib/auth/roles";

function Section({
  heading,
  title,
  children,
}: {
  heading: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">{heading}</h2>
      <SectionBoundary
        title={title}
        fallback={<Skeleton className="h-40 w-full" />}
      >
        {children}
      </SectionBoundary>
    </section>
  );
}

// Phase 4.9 body: independent sections, each in its own boundary so one failure
// never breaks the page (Rule 40.4, 60.12). The access sections (Phase 4R.4)
// render below them for a viewer the server resolved.
export function SettingsContent({
  isAdmin,
  access,
}: {
  isAdmin: boolean;
  access?: { viewer: AccessViewer; stepUp: StepUpActions };
}) {
  const litellm = litellmPanelCapabilities(
    access?.viewer.roles ?? (isAdmin ? [INTERNAL_ADMIN_ROLE] : []),
  );
  return (
    <div className="flex flex-col gap-8">
      <Section heading="Account registry" title="the account registry">
        <AccountRegistry isAdmin={isAdmin} />
      </Section>
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Sync status</h2>
        <SyncStatusPanel />
      </section>
      {litellm.visible ? (
        <Section heading="LiteLLM" title="the LiteLLM connection">
          <LiteLLMPanel capabilities={litellm} />
        </Section>
      ) : null}
      <Section heading="Data retention" title="the data retention policy">
        <DataRetention />
      </Section>
      {access ? (
        <AccessSections viewer={access.viewer} stepUp={access.stepUp} />
      ) : null}
    </div>
  );
}
