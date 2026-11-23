"use client";

import type { AdminScope, IdentityDetail } from "@llm-usage-lens/shared";
import { useMutation } from "@tanstack/react-query";
import { ArrowRightLeft, ShieldPlus, ShieldX, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Panel } from "@/components/display/Panel";
import { MoveTeamDialog } from "@/components/manage/users/detail/MoveTeamDialog";
import { accessErrorMessage } from "@/components/settings/access/access-error-message";
import {
  idPath,
  useOrgUnits,
} from "@/components/settings/access/access-queries";
import { IgnoredSchema } from "@/components/settings/access/access-schemas";
import { ConfirmDialog } from "@/components/settings/access/ConfirmDialog";
import { FormError } from "@/components/settings/access/form-controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { mutateApi } from "@/lib/query/fetch-api";

// Design System - "The user page (unit US2)": team and role (member or lead);
// moving or removing the membership and granting or revoking lead follow
// `moveMember` and `teamAdmins` (D-US7: each uses its existing route). Make
// team lead targets the person's member team (2026-11-24 agent decision).
type LeadScope = IdentityDetail["leadScopes"][number];
type Dialogs =
  | { kind: "move" }
  | { kind: "remove" }
  | { kind: "revoke"; scope: LeadScope }
  | null;

const scopeSegment = (type: AdminScope["scopeType"]) =>
  type === "team" ? "teams" : "departments";

export function UserTeamPanel({
  detail,
  name,
}: {
  detail: IdentityDetail;
  name: string;
}) {
  const router = useRouter();
  const units = useOrgUnits();
  const [dialog, setDialog] = useState<Dialogs>(null);
  const { memberTeamId, leadScopes, allowed } = detail;

  const done = () => {
    setDialog(null);
    router.refresh();
  };
  const move = useMutation({
    mutationFn: (toTeamId: string) =>
      mutateApi(
        `/api/affiliations/${idPath(detail.oid)}/move`,
        "POST",
        {
          fromTeamId: memberTeamId,
          toTeamId,
          version: detail.memberVersion,
        },
        IgnoredSchema,
      ),
    onSuccess: done,
  });
  const remove = useMutation({
    mutationFn: () =>
      mutateApi(
        `/api/teams/${idPath(memberTeamId ?? "")}/members/${idPath(detail.oid)}`,
        "DELETE",
        { version: detail.memberVersion },
        IgnoredSchema,
      ),
    onSuccess: done,
  });
  const grantLead = useMutation({
    mutationFn: () =>
      mutateApi(
        `/api/teams/${idPath(memberTeamId ?? "")}/admins`,
        "POST",
        { oid: detail.oid },
        IgnoredSchema,
      ),
    onSuccess: done,
  });
  const revokeLead = useMutation({
    mutationFn: (scope: LeadScope) =>
      mutateApi(
        `/api/${scopeSegment(scope.scopeType)}/${idPath(scope.scopeId)}/admins/${idPath(detail.oid)}`,
        "DELETE",
        { version: scope.version },
        IgnoredSchema,
      ),
    onSuccess: done,
  });

  const hasUnits = memberTeamId !== null || leadScopes.length > 0;
  if (hasUnits && units.isPending) {
    return (
      <Panel title="Team" boundaryTitle="the team">
        <Skeleton className="h-16 w-full" />
      </Panel>
    );
  }
  const teams = units.data?.teams ?? [];
  const teamName = (id: string) => teams.find((t) => t.id === id)?.name ?? id;
  const scopeName = (scope: LeadScope) =>
    scope.scopeType === "team"
      ? teamName(scope.scopeId)
      : (units.data?.departments.find((d) => d.id === scope.scopeId)?.name ??
        scope.scopeId);
  const leadsOwnTeam = leadScopes.some(
    (s) => s.scopeType === "team" && s.scopeId === memberTeamId,
  );
  const canMakeLead =
    allowed.changeLead && memberTeamId !== null && !leadsOwnTeam;

  return (
    <Panel title="Team" boundaryTitle="the team">
      <div className="flex flex-col gap-3">
        {memberTeamId === null && leadScopes.length === 0 ? (
          <p className="text-muted-foreground text-sm">No team.</p>
        ) : null}
        {memberTeamId !== null ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">
              {teamName(memberTeamId)}
            </span>
            <Badge variant="secondary">Member</Badge>
            {allowed.changeMembership ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Move ${name} to another team`}
                  onClick={() => {
                    move.reset();
                    setDialog({ kind: "move" });
                  }}
                >
                  <ArrowRightLeft aria-hidden />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove from team ${teamName(memberTeamId)}`}
                  onClick={() => {
                    remove.reset();
                    setDialog({ kind: "remove" });
                  }}
                >
                  <Trash2 aria-hidden />
                </Button>
              </>
            ) : null}
            {canMakeLead ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Make team lead of ${teamName(memberTeamId)}`}
                disabled={grantLead.isPending}
                onClick={() => grantLead.mutate()}
              >
                <ShieldPlus aria-hidden />
              </Button>
            ) : null}
          </div>
        ) : null}
        {leadScopes.map((scope) => (
          <div
            key={`${scope.scopeType}:${scope.scopeId}`}
            className="flex flex-wrap items-center gap-2"
          >
            <span className="text-sm font-medium">{scopeName(scope)}</span>
            <Badge variant="outline">Lead</Badge>
            {allowed.changeLead ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Revoke lead of ${scopeName(scope)}`}
                onClick={() => {
                  revokeLead.reset();
                  setDialog({ kind: "revoke", scope });
                }}
              >
                <ShieldX aria-hidden />
              </Button>
            ) : null}
          </div>
        ))}
        {grantLead.isError ? (
          <FormError>{accessErrorMessage(grantLead.error)}</FormError>
        ) : null}
      </div>
      {dialog?.kind === "move" && memberTeamId !== null ? (
        <MoveTeamDialog
          fromTeamId={memberTeamId}
          teams={teams}
          pending={move.isPending}
          error={move.isError ? accessErrorMessage(move.error) : null}
          onMove={(toTeamId) => move.mutate(toTeamId)}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "remove" && memberTeamId !== null ? (
        <ConfirmDialog
          title="Remove from team"
          description={`Remove ${name} from ${teamName(memberTeamId)}?`}
          confirmLabel="Remove"
          pending={remove.isPending}
          error={remove.isError ? accessErrorMessage(remove.error) : null}
          onConfirm={() => remove.mutate()}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "revoke" ? (
        <ConfirmDialog
          title="Revoke lead"
          description={`Revoke ${name} as lead of ${scopeName(dialog.scope)}?`}
          confirmLabel="Revoke"
          pending={revokeLead.isPending}
          error={
            revokeLead.isError ? accessErrorMessage(revokeLead.error) : null
          }
          onConfirm={() => revokeLead.mutate(dialog.scope)}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </Panel>
  );
}
