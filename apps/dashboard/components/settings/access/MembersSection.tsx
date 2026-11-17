"use client";

import { MemberRowSchema } from "@llm-usage-lens/shared";
import type { MemberRow, OrgUnits } from "@llm-usage-lens/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, Trash2 } from "lucide-react";
import { parseAsString, useQueryState } from "nuqs";
import { useState } from "react";
import type { FormEvent } from "react";
import { z } from "zod";

import { EmptyState } from "@/components/display/EmptyState";
import { accessErrorMessage } from "@/components/settings/access/access-error-message";
import {
  fetchAllPages,
  idPath,
  rowName,
  useOrgUnits,
} from "@/components/settings/access/access-queries";
import { IgnoredSchema } from "@/components/settings/access/access-schemas";
import { accessCapabilities } from "@/components/settings/access/capabilities";
import { ConfirmDialog } from "@/components/settings/access/ConfirmDialog";
import {
  FormError,
  FormField,
  FormStatus,
  NativeSelect,
} from "@/components/settings/access/form-controls";
import type { AccessViewer } from "@/components/settings/access/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { mutateApi } from "@/lib/query/fetch-api";
import { sectionData } from "@/lib/query/section-data";

// Source: docs/specs/2026-11-10-access-control.md - "Membership, admin scopes
// and lifecycle" (one team per member; Joiner: a work email becomes a pending
// item bound at first sign-in; Mover: atomic move), "Permission matrix",
// "Identity, SSO mapping and defaults" (SSO rows are read-only), "API routes
// (additions)". The write routes enforce the matrix again (Rule 10.3).
const EmailSchema = z.email("Enter a valid email address");

type Dialogs =
  | { kind: "remove"; member: MemberRow }
  | { kind: "move"; member: MemberRow }
  | null;

function MoveDialog({
  member,
  teams,
  pending,
  error,
  onMove,
  onClose,
}: {
  member: MemberRow;
  teams: OrgUnits["teams"];
  pending: boolean;
  error: string | null;
  onMove: (toTeamId: string) => void;
  onClose: () => void;
}) {
  const options = teams.filter((t) => t.id !== member.teamId);
  const [chosen, setChosen] = useState<string | null>(null);
  const destination = chosen ?? options[0]?.id ?? "";
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move member</DialogTitle>
          <DialogDescription>
            Moves the member to another team in one step.
          </DialogDescription>
        </DialogHeader>
        <FormField label="Destination team">
          {(props) => (
            <NativeSelect
              {...props}
              value={destination}
              onChange={(e) => setChosen(e.target.value)}
            >
              {options.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
        {error ? <FormError>{error}</FormError> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={pending || destination === ""}
            onClick={() => onMove(destination)}
          >
            Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MembersSection({ viewer }: { viewer: AccessViewer }) {
  const capabilities = accessCapabilities(viewer);
  const queryClient = useQueryClient();
  const teams = sectionData(useOrgUnits())?.teams;
  // On the Team page the page's picker owns ?team=; this section follows it
  // (Design System - Management pages, Team page views and links). A pick here
  // stays local until the page's team changes again.
  const [pageTeam] = useQueryState("team", parseAsString);
  const [chosen, setChosen] = useState<string | null>(null);
  const [seenPageTeam, setSeenPageTeam] = useState(pageTeam);
  if (seenPageTeam !== pageTeam) {
    setSeenPageTeam(pageTeam);
    setChosen(null);
  }
  const known = (id: string | null) =>
    id !== null && teams?.some((t) => t.id === id) ? id : null;
  const teamId = known(chosen) ?? known(pageTeam) ?? teams?.[0]?.id;
  const membersKey = ["access", "members", teamId] as const;
  const membersQuery = useQuery({
    queryKey: membersKey,
    queryFn: () =>
      fetchAllPages(
        `/api/teams/${idPath(teamId ?? "")}/members`,
        MemberRowSchema,
      ),
    enabled: teamId !== undefined,
  });
  const members = sectionData(membersQuery);

  const [dialog, setDialog] = useState<Dialogs>(null);
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["access", "members"] });

  const add = useMutation({
    mutationFn: (emailOrUpn: string) =>
      mutateApi(
        `/api/teams/${idPath(teamId ?? "")}/members`,
        "POST",
        { emailOrUpn },
        IgnoredSchema,
      ),
    onSuccess: (_data, emailOrUpn) => {
      setEmail("");
      setNotice(
        `${emailOrUpn} is pending and is added to the team at their first sign-in.`,
      );
      void refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (member: MemberRow) =>
      mutateApi(
        `/api/teams/${idPath(member.teamId)}/members/${idPath(member.oid)}`,
        "DELETE",
        { version: member.version },
        IgnoredSchema,
      ),
    onSuccess: () => {
      setDialog(null);
      void refresh();
    },
    onError: () => void refresh(),
  });
  const move = useMutation({
    mutationFn: (input: { member: MemberRow; toTeamId: string }) =>
      mutateApi(
        `/api/affiliations/${idPath(input.member.oid)}/move`,
        "POST",
        {
          fromTeamId: input.member.teamId,
          toTeamId: input.toTeamId,
          version: input.member.version,
        },
        IgnoredSchema,
      ),
    onSuccess: () => {
      setDialog(null);
      void refresh();
    },
    onError: () => void refresh(),
  });

  if (teams === undefined || members === undefined) {
    if (teams !== undefined && teamId === undefined) {
      return <EmptyState title="No teams to manage." />;
    }
    return <Skeleton className="h-48 w-full" />;
  }
  if (teamId === undefined) return <EmptyState title="No teams to manage." />;

  function submit(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    add.reset();
    const parsed = EmailSchema.safeParse(email.trim());
    if (!parsed.success) {
      setEmailError(parsed.error.issues[0]?.message);
      return;
    }
    setEmailError(undefined);
    add.mutate(parsed.data);
  }

  function open(next: Dialogs) {
    remove.reset();
    move.reset();
    setDialog(next);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="max-w-[72ch]">
        <FormField label="Team">
          {(props) => (
            <NativeSelect
              {...props}
              value={teamId}
              onChange={(e) => {
                setChosen(e.target.value);
                setNotice(null);
                add.reset();
              }}
            >
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
      </div>

      {members.length === 0 ? (
        <EmptyState title="No members in this team yet." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Person</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => {
              const name = rowName(member);
              const email = member.email;
              return (
                <TableRow key={member.oid}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span>{name}</span>
                      {email && email !== name ? (
                        <span className="text-muted-foreground text-xs">
                          {email}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    {member.source === "sso" ? (
                      <Badge variant="outline">Managed in Entra</Badge>
                    ) : (
                      <Badge variant="outline">Added here</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {member.source === "ui" ? (
                      <div className="flex items-center gap-1">
                        {capabilities.moveMember ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Move ${name}`}
                            onClick={() => open({ kind: "move", member })}
                          >
                            <ArrowRightLeft aria-hidden />
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Remove ${name}`}
                          onClick={() => open({ kind: "remove", member })}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </div>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <form
        onSubmit={submit}
        noValidate
        className="flex max-w-[72ch] flex-col gap-3"
      >
        <FormField label="Work email or UPN" error={emailError}>
          {(props) => (
            <Input
              {...props}
              type="text"
              inputMode="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </FormField>
        <div>
          <Button type="submit" size="sm" disabled={add.isPending}>
            Add member
          </Button>
        </div>
        {add.isError ? (
          <FormError>{accessErrorMessage(add.error)}</FormError>
        ) : null}
        {notice ? <FormStatus>{notice}</FormStatus> : null}
      </form>

      {dialog?.kind === "remove" ? (
        <ConfirmDialog
          title="Remove member"
          description={`Remove ${rowName(dialog.member)} from this team?`}
          confirmLabel="Remove"
          pending={remove.isPending}
          error={remove.isError ? accessErrorMessage(remove.error) : null}
          onConfirm={() => remove.mutate(dialog.member)}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "move" ? (
        <MoveDialog
          member={dialog.member}
          teams={teams}
          pending={move.isPending}
          error={move.isError ? accessErrorMessage(move.error) : null}
          onMove={(toTeamId) =>
            move.mutate({ member: dialog.member, toTeamId })
          }
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}
