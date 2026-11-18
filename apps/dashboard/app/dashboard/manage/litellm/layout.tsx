import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { auth } from "@/auth";
import { PageHeader } from "@/components/layout/PageHeader";
import { managementAccessFor } from "@/lib/manage-access";

import { LiteLLMAreaTabs } from "./LiteLLMAreaTabs";

// Design System - Management pages, LiteLLM area (D2): admin, org-admin and
// auditor read-only; a lead and a user get the missing-page 404. A layout is
// not re-run on soft navigation, so every tab page authorizes itself again;
// nothing here is cached (Rule 60.10). The page h1 stays in the top bar.
export default async function LiteLLMAreaLayout({
  children,
}: {
  children: ReactNode;
}) {
  if (!(await managementAccessFor(await auth())).litellm) notFound();
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        description="LiteLLM organisation spend, teams and their links, and users, as LiteLLM reports them."
        tabs={<LiteLLMAreaTabs />}
      />
      {children}
    </div>
  );
}
