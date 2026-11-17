import { notFound } from "next/navigation";

import { auth } from "@/auth";
import { PageHeader } from "@/components/layout/PageHeader";
import { LiteLLMSection } from "@/components/litellm/LiteLLMSection";
import { UserSearch } from "@/components/litellm/UserSearch";
import { managementAccessFor } from "@/lib/manage-access";

// Design System - Management pages, Users (global readers only; slice B2,
// B2-7). The h1 stays in the top bar.
export default async function UsersManagePage() {
  const access = await managementAccessFor(await auth());
  if (!access.users) notFound();
  return (
    <div className="flex flex-col gap-4">
      <PageHeader description="Look up a person's LiteLLM spend, budget and keys." />
      <LiteLLMSection title="Users">
        <UserSearch />
      </LiteLLMSection>
    </div>
  );
}
