import { Suspense } from "react";

import { DepartmentDetailContent } from "@/components/departments/DepartmentDetailContent";
import { Skeleton } from "@/components/ui/skeleton";
import { requireGlobalReader } from "@/lib/usage-access";

type DepartmentDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function DepartmentDetailPage({
  params,
}: DepartmentDetailPageProps) {
  await requireGlobalReader();
  const { id } = await params;
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <DepartmentDetailContent id={id} />
    </Suspense>
  );
}
