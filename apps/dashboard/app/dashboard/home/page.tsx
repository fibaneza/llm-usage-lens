import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { scopeFor } from "@/lib/api/scoped-rollups";
import { landingPathFor } from "@/lib/nav";

// Source: implementation-phases Phase 4R.5 (role-aware landing). The scope is
// read per request from the stored authorization data, not the role claim
// (Rule 60.10).
export default async function HomePage() {
  const session = await auth();
  if (!session) redirect("/sign-in");
  redirect(landingPathFor(await scopeFor(session, [])));
}
