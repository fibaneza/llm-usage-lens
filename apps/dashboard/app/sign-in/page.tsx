import { trace } from "@opentelemetry/api";
import { AuthError } from "next-auth";

import {
  enabledSignInProviders,
  signInWithDevLogin,
  signInWithEntra,
  signInWithMasterUser,
  signInWithPassword,
} from "@/auth";
import { Panel } from "@/components/display/Panel";
import { SignInOptions } from "@/components/auth/SignInOptions";
import { getPasswordSignIn } from "@/lib/data/access/password-users";

// Enabled providers depend on runtime env, so never prerender at build time.
export const dynamic = "force-dynamic";

async function signInMaster(formData: FormData): Promise<{ ok: false } | void> {
  "use server";
  try {
    await signInWithMasterUser(formData);
  } catch (error) {
    if (error instanceof AuthError) return { ok: false };
    throw error;
  }
}

// Design System - Sign-in page, The forms (T-SI5); Access Control D24: read per
// request, never cached; a failed read fails closed (the group is absent).
async function passwordEnabled(): Promise<boolean> {
  try {
    return (await getPasswordSignIn()).enabled;
  } catch (error) {
    trace
      .getActiveSpan()
      ?.recordException(error instanceof Error ? error : String(error));
    return false;
  }
}

export default async function SignInPage() {
  const password = await passwordEnabled();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 p-8 text-center">
      <h1 className="text-foreground text-2xl font-semibold">LLM Usage Lens</h1>
      <Panel
        title="Sign in"
        boundaryTitle="the sign-in options"
        className="w-full max-w-sm text-left"
      >
        <SignInOptions
          {...enabledSignInProviders}
          entraAction={signInWithEntra}
          devLoginAction={signInWithDevLogin}
          masterAction={signInMaster}
          password={password}
          passwordAction={signInWithPassword}
        />
      </Panel>
    </main>
  );
}
