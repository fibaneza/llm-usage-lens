import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-foreground text-2xl font-semibold">
        Bedrock Cost Dashboard
      </h1>
      <p className="text-muted-foreground max-w-md">
        AWS Bedrock usage and cost tracking across the organization.
      </p>
      <Link
        href="/sign-in"
        className="bg-primary text-primary-foreground ring-ring rounded-md px-4 py-2 font-medium outline-none focus-visible:ring-2"
      >
        Sign in
      </Link>
    </main>
  );
}
