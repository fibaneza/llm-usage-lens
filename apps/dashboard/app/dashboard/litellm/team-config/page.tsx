import { redirect } from "next/navigation";

// Slice B2, B2-3: the interim team-configuration route now lives on the Team
// Management page; `?team=` travels along. The target page applies the gate.
export default async function TeamConfigRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string }>;
}) {
  const { team } = await searchParams;
  redirect(
    team
      ? `/dashboard/manage/team?${new URLSearchParams({ team }).toString()}`
      : "/dashboard/manage/team",
  );
}
