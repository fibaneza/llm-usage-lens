import { auth } from "@/auth";
import { ChangePasswordForm } from "@/components/account/ChangePasswordForm";
import { AUTH_METHOD_LABELS } from "@/lib/auth/roles";
import { getPasswordCredential } from "@/lib/data/access/password-credentials-store";

// Source: docs/specs/2026-11-10-access-control.md (D30)
// - "Password users" (POST /api/account/password is for password sessions
// only). The sign-in method and the TOTP enrolment are resolved on the server
// (Rule 10.3, 50.3); the route enforces them again. Per-request, uncached
// (Rule 60.10: authorization data).
function methodLabel(method: string | undefined): string {
  return (
    Object.entries(AUTH_METHOD_LABELS).find(([key]) => key === method)?.[1] ??
    "Password"
  );
}

export default async function AccountPage() {
  const session = await auth();
  const user = session?.user;
  const isPasswordUser = user?.authMethod === "password";
  const credential =
    isPasswordUser && user?.email
      ? await getPasswordCredential(user.email)
      : null;

  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-foreground text-xl font-semibold tracking-tight">
        Account
      </h2>
      <dl className="flex max-w-[72ch] flex-col gap-3 text-sm">
        {user?.email ? (
          <div className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground">Email</dt>
            <dd>{user.email}</dd>
          </div>
        ) : null}
        <div className="flex flex-col gap-0.5">
          <dt className="text-muted-foreground">Sign-in method</dt>
          <dd>{methodLabel(user?.authMethod)}</dd>
        </div>
      </dl>
      {isPasswordUser ? (
        <ChangePasswordForm totpEnrolled={Boolean(credential?.totpCipher)} />
      ) : null}
    </section>
  );
}
