import { notFound, redirect } from "next/navigation";

import { auth } from "@/auth";
import { loadSettingsAccessViewer } from "@/lib/auth/settings-access";
import { managementAccessFor } from "@/lib/manage-access";
import { settingsTabsFor } from "@/lib/settings-tabs";

// Design System "Settings Page": the index redirects on the server to the
// caller's first visible tab. The browser keeps a `#<slug>` fragment across the
// redirect, so the hash resolver in the layout can still place it. The former
// `?section=audit` entry goes to Management -> Audit (slice B2, B2-3; the
// target applies its own gate).
export default async function SettingsIndexPage({
  searchParams,
}: {
  searchParams?: Promise<{ section?: string | string[] }>;
} = {}) {
  const session = await auth();
  if (!(await managementAccessFor(session)).settings) notFound();
  if ((await searchParams)?.section === "audit") {
    redirect("/dashboard/manage/audit");
  }
  const tabs = settingsTabsFor(await loadSettingsAccessViewer(session));
  const [first] = tabs;
  if (!first) notFound();
  redirect(first.href);
}
