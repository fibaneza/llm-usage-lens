import { notFound } from "next/navigation";

import { auth, enabledSignInProviders } from "@/auth";
import { UsersPeoplePanel } from "@/components/manage/users/UsersPeoplePanel";
import { PageHeader } from "@/components/layout/PageHeader";
import { LiteLLMSection } from "@/components/litellm/LiteLLMSection";
import { UserSearch } from "@/components/litellm/UserSearch";
import { isLiteLLMConfigured } from "@/lib/litellm/client";
import { enabledOperations } from "@/lib/litellm/read-views";
import { managementAccessFor } from "@/lib/manage-access";
import { usersPageAccessFor } from "@/lib/manage-users-access";

import {
  stepUpWithCredentials,
  stepUpWithDevLogin,
  stepUpWithEntra,
} from "../../settings/step-up-actions";

// Design System - Management pages, Users (global readers only; slice B2,
// B2-7) and Management improvements, Users (D15). The h1 stays in the top
// bar. Which Add user steps and link controls render is resolved here, per
// request, from the effective roles (Rule 10.3, 50.3).
export default async function UsersManagePage() {
  const session = await auth();
  const access = await managementAccessFor(session);
  if (!access.users) notFound();
  const page = await usersPageAccessFor(session, enabledSignInProviders.entra);
  if (!page) notFound();
  const litellmConfigured = await isLiteLLMConfigured();
  const canCreate =
    litellmConfigured && (await enabledOperations()).includes("createUser");
  return (
    <div className="flex flex-col gap-4">
      <PageHeader description="People, their teams and LiteLLM links, and a lookup of a person's LiteLLM spend, budget and keys." />
      <UsersPeoplePanel
        steps={page.steps}
        ownOid={page.ownOid}
        canCreate={canCreate}
        litellmConfigured={litellmConfigured}
        authMethod={page.authMethod}
        stepUp={{
          entra: stepUpWithEntra,
          credentials: stepUpWithCredentials,
          devLogin: stepUpWithDevLogin,
        }}
      />
      <LiteLLMSection title="Search LiteLLM users">
        <UserSearch />
      </LiteLLMSection>
    </div>
  );
}
