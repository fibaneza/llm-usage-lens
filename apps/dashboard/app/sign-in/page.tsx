import { signIn } from "@/auth";

export default function SignInPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 p-8 text-center">
      <h1 className="text-foreground text-2xl font-semibold">
        Bedrock Cost Dashboard
      </h1>
      <form
        action={async () => {
          "use server";
          await signIn("microsoft-entra-id", { redirectTo: "/dashboard" });
        }}
      >
        <button
          type="submit"
          className="bg-primary text-primary-foreground ring-ring rounded-md px-5 py-2.5 font-medium outline-none focus-visible:ring-2"
        >
          Sign in with Microsoft
        </button>
      </form>
    </main>
  );
}
