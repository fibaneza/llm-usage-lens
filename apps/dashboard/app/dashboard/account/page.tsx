import { auth } from "@/auth";
import { ChangePasswordForm } from "@/components/account/ChangePasswordForm";
import { Panel } from "@/components/display/Panel";
import { PageHeader } from "@/components/layout/PageHeader";
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
    <div className="flex flex-col gap-4">
      <PageHeader description="Your sign-in details and password." />
      <Panel
        title="Sign-in details"
        boundaryTitle="your sign-in details"
        className="max-w-[72ch]"
      >
        <div className="flex flex-col gap-6">
          <dl className="flex flex-col gap-3 text-sm">
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
            <ChangePasswordForm
              totpEnrolled={Boolean(credential?.totpCipher)}
            />
          ) : null}
        </div>
      </Panel>
    </div>
  );
}
