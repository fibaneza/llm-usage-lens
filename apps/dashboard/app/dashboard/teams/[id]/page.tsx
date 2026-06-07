type TeamDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function TeamDetailPage({ params }: TeamDetailPageProps) {
  const { id } = await params;
  return (
    <p className="text-muted-foreground text-sm">
      Placeholder — team detail for <span className="font-mono">{id}</span>{" "}
      arrives in Phase 4.6.
    </p>
  );
}
