import { notFound, redirect } from "next/navigation";

import { auth } from "@/auth";
import { loadSettingsAccessViewer } from "@/lib/auth/settings-access";
import { settingsTabsFor } from "@/lib/settings-tabs";

// Design System "Settings Page": the index redirects on the server to the
// caller's first visible tab. The browser keeps a `#<slug>` fragment across the
// redirect, so the hash resolver in the layout can still place it.
export default async function SettingsIndexPage() {
  const session = await auth();
  const tabs = settingsTabsFor(await loadSettingsAccessViewer(session));
  const [first] = tabs;
  if (!first) notFound();
  redirect(first.href);
}
