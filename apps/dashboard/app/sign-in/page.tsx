import {
  enabledSignInProviders,
  signInWithDevLogin,
  signInWithEntra,
  signInWithMasterUser,
} from "@/auth";
import { SignInOptions } from "@/components/auth/SignInOptions";

// Enabled providers depend on runtime env, so never prerender at build time.
export const dynamic = "force-dynamic";

export default function SignInPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 p-8 text-center">
      <h1 className="text-foreground text-2xl font-semibold">LLM Usage Lens</h1>
      <SignInOptions
        {...enabledSignInProviders}
        entraAction={signInWithEntra}
        devLoginAction={signInWithDevLogin}
        masterAction={signInWithMasterUser}
      />
    </main>
  );
}
