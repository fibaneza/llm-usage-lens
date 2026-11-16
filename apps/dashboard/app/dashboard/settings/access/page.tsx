import { notFound, redirect } from "next/navigation";

import { auth } from "@/auth";
import { loadSettingsAccessViewer } from "@/lib/auth/settings-access";
import { settingsTabsFor } from "@/lib/settings-tabs";

// Redirects to the first visible sub-tab; a caller with none gets the 404.
export default async function AccessIndexPage() {
  const session = await auth();
  const viewer = await loadSettingsAccessViewer(session);
  const first = settingsTabsFor(viewer).find((t) => t.id === "access")
    ?.subTabs[0];
  if (!first) notFound();
  redirect(first.href);
}
