import { notFound } from "next/navigation";

import { auth } from "@/auth";
import { PageHeader } from "@/components/layout/PageHeader";
import { LiteLLMSection } from "@/components/litellm/LiteLLMSection";
import { OrganisationSection } from "@/components/litellm/OrganisationSection";
import { managementAccessFor } from "@/lib/manage-access";

// Design System - Management pages, Organisation (global readers only; slice
// B2, B2-7). The h1 stays in the top bar.
export default async function OrganisationManagePage() {
  const access = await managementAccessFor(await auth());
  if (!access.organisation) notFound();
  return (
    <div className="flex flex-col gap-4">
      <PageHeader description="Organisation-wide spend and budgets as LiteLLM reports them." />
      <LiteLLMSection title="Organisation" reported>
        <OrganisationSection />
      </LiteLLMSection>
    </div>
  );
}
