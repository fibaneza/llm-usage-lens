type DepartmentDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function DepartmentDetailPage({
  params,
}: DepartmentDetailPageProps) {
  const { id } = await params;
  return (
    <section>
      <h1 className="text-2xl font-semibold">Department {id}</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        Placeholder — department detail arrives in Phase 4.4.
      </p>
    </section>
  );
}
