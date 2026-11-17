import { redirect } from "next/navigation";

// Design System - Navigation (Sidebar), Routes and redirects; slice B2, B2-3.
// The LiteLLM tab row is gone: each former tab is a Management route, and
// anything else lands on My usage. A server `redirect()` (reversible); the
// target page applies its own gate, so a caller who may not see it gets that
// page's 404 (Hidden means absent). The other query parameters (the date
// range) travel along.
const TARGETS: ReadonlyMap<string, string> = new Map([
  ["team", "/dashboard/manage/team"],
  ["organisation", "/dashboard/manage/organisation"],
  ["users", "/dashboard/manage/users"],
  ["audit", "/dashboard/manage/audit"],
]);

export default async function LiteLLMRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tab, ...rest } = await searchParams;
  const target =
    typeof tab === "string"
      ? (TARGETS.get(tab) ?? "/dashboard/me")
      : "/dashboard/me";
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(rest)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined) query.append(key, item);
    }
  }
  const search = query.toString();
  redirect(search ? `${target}?${search}` : target);
}
