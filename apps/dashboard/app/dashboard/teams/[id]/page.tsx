type TeamDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function TeamDetailPage({ params }: TeamDetailPageProps) {
  const { id } = await params;
  return (
    <section>
      <h1 className="text-2xl font-semibold">Team {id}</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        Placeholder — team detail arrives in Phase 4.6.
      </p>
    </section>
  );
}
