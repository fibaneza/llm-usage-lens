import { redirect } from "next/navigation";
import { Suspense } from "react";

import { auth } from "@/auth";
import { Skeleton } from "@/components/ui/skeleton";
import { UsersContent } from "@/components/users/UsersContent";
import { scopeFor } from "@/lib/api/scoped-rollups";
import { scopeNoticeFor } from "@/lib/scope-labels";

// Server Component shell (Rule 60.7); UsersContent reads the URL via nuqs,
// so it sits under Suspense for static prerender (Rule 60.12).
// The "your teams" notice is read per request (Design System — Access states
// and scoped labels; Rule 60.10).
export default async function UsersPage() {
  const session = await auth();
  if (!session) redirect("/sign-in");
  const notice = scopeNoticeFor(await scopeFor(session, []));

  return (
    <div className="flex flex-col gap-4">
      {notice === null ? null : (
        <p className="text-muted-foreground max-w-[72ch] text-sm">{notice}</p>
      )}
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <UsersContent />
      </Suspense>
    </div>
  );
}
