import { EmptyState } from "@/components/display/EmptyState";
import { withBasePath } from "@/lib/base-path";

// Reachable without a session: failed-closed sign-ins land here
// (Access Control spec — Rollout; Auth.js `pages.error`).
export default async function NoAccessPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-8">
      <EmptyState
        title="You don't have access to LLM Usage Lens. Contact your administrator."
        action={
          <a
            href={withBasePath("/sign-in")}
            className="text-primary ring-ring rounded-md text-sm font-medium underline outline-none focus-visible:ring-2"
          >
            Sign in again
          </a>
        }
      />
    </main>
  );
}
