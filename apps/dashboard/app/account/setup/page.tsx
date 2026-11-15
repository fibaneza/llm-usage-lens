import { previewPasswordSetupLink, signInWithPasswordSetup } from "@/auth";
import { PasswordSetupForm } from "@/components/auth/PasswordSetupForm";
import { generateTotpSecret } from "@/lib/auth/totp-user";

// Source: docs/specs/2026-11-10-access-control.md - "Password users" (Setup
// D22: https://<host>/account/setup#<token>; the proxy leaves /account/*
// public). A fresh TOTP secret per render; it is stored only when the person
// submits a valid code.
export const dynamic = "force-dynamic";

export default function AccountSetupPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 p-6 text-center">
      <h1 className="text-foreground text-2xl font-semibold">
        Set your password
      </h1>
      <PasswordSetupForm
        totpSecret={generateTotpSecret()}
        previewAction={previewPasswordSetupLink}
        setupAction={signInWithPasswordSetup}
      />
    </main>
  );
}
