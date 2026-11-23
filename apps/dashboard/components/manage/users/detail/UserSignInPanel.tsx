"use client";

import type { IdentityDetail } from "@llm-usage-lens/shared";
import Link from "next/link";

import { Panel } from "@/components/display/Panel";
import { AUTH_METHOD_LABELS } from "@/lib/auth/roles";

// Design System - "The user page (unit US2)" D-US10, D-US12: how the person
// signs in; a password user also shows the SSO reference read-only when the
// response carries it (admin and auditor). Password reset, authenticator reset,
// disable and delete stay in Settings.
const PASSWORD_USERS_HREF = "/dashboard/settings/access/sign-in#password-users";

function Row({ label, children }: { label: string; children: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-sm break-all">{children}</dd>
    </div>
  );
}

export function UserSignInPanel({
  detail,
  canOpenPasswordUsers,
}: {
  detail: IdentityDetail;
  canOpenPasswordUsers: boolean;
}) {
  const isPassword = detail.authMethod === "password";
  const sso = detail.sso;
  return (
    <Panel title="Sign-in" boundaryTitle="the sign-in details">
      <div className="flex flex-col gap-3">
        <p className="text-sm">
          {detail.authMethod === "password"
            ? "Signs in with a password"
            : AUTH_METHOD_LABELS[detail.authMethod]}
        </p>
        {isPassword && sso ? (
          <dl className="grid gap-3 sm:grid-cols-2">
            <Row label="Expected UPN">{sso.expectedUpn}</Row>
            {sso.expectedOid ? (
              <Row label="Expected Entra id">{sso.expectedOid}</Row>
            ) : null}
          </dl>
        ) : null}
        {isPassword && sso?.boundAt ? (
          <p className="text-sm">
            Signs in with SSO since {sso.boundAt.slice(0, 10)}
          </p>
        ) : null}
        {isPassword && canOpenPasswordUsers ? (
          <p className="text-sm">
            <Link href={PASSWORD_USERS_HREF} className="text-primary underline">
              Password users in Settings
            </Link>
          </p>
        ) : null}
      </div>
    </Panel>
  );
}
