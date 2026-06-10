import { PageHeader } from "@/components/layout/PageHeader";

type DepartmentDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function DepartmentDetailPage({
  params,
}: DepartmentDetailPageProps) {
  const { id } = await params;
  return (
    <>
      <PageHeader description="Teams, cost trend, and top users for this department." />
      <p className="text-muted-foreground text-sm">
        Placeholder — department detail for{" "}
        <span className="font-mono">{id}</span> arrives in Phase 4.4.
      </p>
    </>
  );
}
