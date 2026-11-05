import { Suspense } from "react";

import { TeamDetailContent } from "@/components/teams/TeamDetailContent";
import { Skeleton } from "@/components/ui/skeleton";

type TeamDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function TeamDetailPage({ params }: TeamDetailPageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <TeamDetailContent id={id} />
    </Suspense>
  );
}
