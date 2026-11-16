import "server-only";

import { notFound, redirect } from "next/navigation";

import { auth } from "@/auth";
import { scopeFor } from "@/lib/api/scoped-rollups";

// Usage routes are organisation-level: a caller whose stored scope is not
// global gets the same 404 as a missing page (Access Control - Navigation and
// landing by role; Rule 10.3). Read per request, never cached (Rule 60.10).
export async function requireGlobalReader(): Promise<void> {
  const session = await auth();
  if (!session) redirect("/sign-in");
  const scope = await scopeFor(session, []);
  if (!scope.global) notFound();
}
