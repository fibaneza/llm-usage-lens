"use client";

import type { GrantableRole, IdentityDetail } from "@llm-usage-lens/shared";
import { useMutation } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { FieldHelp } from "@/components/display/FieldHelp";
import { Panel } from "@/components/display/Panel";
import { GrantRoleDialog } from "@/components/manage/users/detail/GrantRoleDialog";
import {
  accessErrorMessage,
  isReauthRequired,
} from "@/components/settings/access/access-error-message";
import { idPath } from "@/components/settings/access/access-queries";
import { IgnoredSchema } from "@/components/settings/access/access-schemas";
import { ConfirmDialog } from "@/components/settings/access/ConfirmDialog";
import { StepUpDialog } from "@/components/settings/access/StepUpDialog";
import type {
  AccessViewer,
  StepUpActions,
} from "@/components/settings/access/types";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { mutateApi } from "@/lib/query/fetch-api";

// Design System - "The user page (unit US2)" D-US11: admin edits (never its own
// page), auditor and org-admin read. The writes are the Settings routes; a
// write answered REAUTH_REQUIRED asks 'Confirm it's you' and is never replayed
// (Access Control - Recent authentication, D28).
type Grant = NonNullable<IdentityDetail["roleGrants"]>[number];
const NOT_RECENT =
  "Your sign-in could not be confirmed as recent. Sign out and sign in again, then retry.";

export function UserRolesPanel({
  detail,
  grants,
  name,
  authMethod,
  stepUp,
}: {
  detail: IdentityDetail;
  grants: readonly Grant[];
  name: string;
  authMethod: AccessViewer["authMethod"];
  stepUp: StepUpActions;
}) {
  const router = useRouter();
  const canEdit = detail.allowed.editRoles;
  const [granting, setGranting] = useState(false);
  const [revoking, setRevoking] = useState<Grant | null>(null);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [steppedUp, setSteppedUp] = useState(false);
  const [notRecent, setNotRecent] = useState(false);

  function onWriteError(error: unknown) {
    if (!isReauthRequired(error)) return;
    if (steppedUp) setNotRecent(true);
    else setStepUpOpen(true);
  }
  const done = () => {
    setGranting(false);
    setRevoking(null);
    setSteppedUp(false);
    router.refresh();
  };
  const grant = useMutation({
    mutationFn: (input: { role: GrantableRole; reason: string }) =>
      mutateApi(
        "/api/role-grants",
        "POST",
        { oid: detail.oid, role: input.role, reason: input.reason },
        IgnoredSchema,
      ),
    onSuccess: done,
    onError: onWriteError,
  });
  const revoke = useMutation({
    mutationFn: (target: Grant) =>
      mutateApi(
        `/api/role-grants/${idPath(detail.oid)}/${idPath(target.role)}`,
        "DELETE",
        { version: target.version },
        IgnoredSchema,
      ),
    onSuccess: done,
    onError: onWriteError,
  });

  function messageFor(mutation: { isError: boolean; error: unknown }) {
    if (notRecent) return NOT_RECENT;
    if (!mutation.isError || isReauthRequired(mutation.error)) return null;
    return accessErrorMessage(mutation.error);
  }

  return (
    <Panel
      title="Global roles"
      boundaryTitle="the global roles"
      badge={
        <FieldHelp field="Global roles">
          Roles that apply to the whole organisation, granted here by an admin.
        </FieldHelp>
      }
      actions={
        canEdit ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              grant.reset();
              setNotRecent(false);
              setGranting(true);
            }}
          >
            <Plus aria-hidden />
            Grant role
          </Button>
        ) : null
      }
    >
      {grants.length === 0 ? (
        <p className="text-muted-foreground text-sm">No roles granted here.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {grants.map((item) => (
            <li key={item.role} className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">
                {ROLE_LABELS[item.role]}
              </span>
              <span className="text-muted-foreground text-xs">
                since {item.grantedAt.slice(0, 10)}
              </span>
              {canEdit ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Revoke ${ROLE_LABELS[item.role]} from ${name}`}
                  onClick={() => {
                    revoke.reset();
                    setNotRecent(false);
                    setRevoking(item);
                  }}
                >
                  <Trash2 aria-hidden />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {granting ? (
        <GrantRoleDialog
          pending={grant.isPending}
          serverError={messageFor(grant)}
          onGrant={(role, reason) => {
            setNotRecent(false);
            grant.mutate({ role, reason });
          }}
          onClose={() => setGranting(false)}
        />
      ) : null}
      {revoking ? (
        <ConfirmDialog
          title="Revoke role"
          description={`Revoke ${ROLE_LABELS[revoking.role]} from ${name}?`}
          confirmLabel="Revoke"
          pending={revoke.isPending}
          error={messageFor(revoke)}
          onConfirm={() => {
            setNotRecent(false);
            revoke.mutate(revoking);
          }}
          onClose={() => setRevoking(null)}
        />
      ) : null}
      {stepUpOpen ? (
        <StepUpDialog
          authMethod={authMethod}
          stepUp={stepUp}
          section="role-grants"
          onDone={() => {
            setStepUpOpen(false);
            setSteppedUp(true);
          }}
          onClose={() => setStepUpOpen(false)}
          onRedirect={() => {
            setStepUpOpen(false);
            setGranting(false);
            setRevoking(null);
          }}
        />
      ) : null}
    </Panel>
  );
}
