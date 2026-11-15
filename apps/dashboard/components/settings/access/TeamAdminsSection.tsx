"use client";

import { AdminScopeRowSchema } from "@llm-usage-lens/shared";
import type { AdminScopeRow } from "@llm-usage-lens/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
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
// and lifecycle" (an admin scope covers a team or a department), "Permission
// matrix" (department scopes: internal-admin and internal-org-admin only),
// "Identity, SSO mapping and defaults" (SSO scopes are read-only), "API routes
// (additions)". The write routes enforce the matrix again (Rule 10.3).
const EmailSchema = z.email("Enter a valid email address");

type ScopeOption = {
  key: string;
  type: "team" | "department";
  id: string;
  label: string;
};

function scopePath(type: "team" | "department", id: string) {
  return `/api/${type === "team" ? "teams" : "departments"}/${idPath(id)}/admins`;
}

export function TeamAdminsSection({ viewer }: { viewer: AccessViewer }) {
  const capabilities = accessCapabilities(viewer);
  const queryClient = useQueryClient();
  const orgUnits = sectionData(useOrgUnits());

  const [chosen, setChosen] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<AdminScopeRow | null>(null);

  const options: ScopeOption[] = orgUnits
    ? [
        ...orgUnits.teams.map((t) => ({
          key: `team:${t.id}`,
          type: "team" as const,
          id: t.id,
          label: `Team: ${t.name}`,
        })),
        ...(capabilities.grantDepartmentAdmin
          ? orgUnits.departments.map((d) => ({
              key: `department:${d.id}`,
              type: "department" as const,
              id: d.id,
              label: `Department: ${d.name}`,
            }))
          : []),
      ]
    : [];
  const scope = options.find((o) => o.key === chosen) ?? options[0];

  const adminsQuery = useQuery({
    queryKey: ["access", "admins", scope?.key],
    queryFn: () =>
      fetchAllPages(
        scopePath(scope?.type ?? "team", scope?.id ?? ""),
        AdminScopeRowSchema,
      ),
    enabled: scope !== undefined,
  });
  const admins = sectionData(adminsQuery);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["access", "admins"] });

  const add = useMutation({
    mutationFn: (emailOrUpn: string) =>
      mutateApi(
        scopePath(scope?.type ?? "team", scope?.id ?? ""),
        "POST",
        { emailOrUpn },
        IgnoredSchema,
      ),
    onSuccess: (_data, emailOrUpn) => {
      setEmail("");
      setNotice(
        `${emailOrUpn} is pending and becomes an admin at their first sign-in.`,
      );
      void refresh();
    },
  });
  const revoke = useMutation({
    mutationFn: (admin: AdminScopeRow) =>
      mutateApi(
        `${scopePath(admin.scopeType, admin.scopeId)}/${idPath(admin.oid)}`,
        "DELETE",
        { version: admin.version },
        IgnoredSchema,
      ),
    onSuccess: () => {
      setRevoking(null);
      void refresh();
    },
    onError: () => void refresh(),
  });

  if (orgUnits === undefined) {
    return <Skeleton className="h-48 w-full" />;
  }
  if (scope === undefined) return <EmptyState title="No teams to manage." />;
  if (admins === undefined) {
    return <Skeleton className="h-48 w-full" />;
  }

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

  return (
    <div className="flex flex-col gap-4">
      <div className="max-w-[72ch]">
        <FormField label="Scope">
          {(props) => (
            <NativeSelect
              {...props}
              value={scope.key}
              onChange={(e) => {
                setChosen(e.target.value);
                setNotice(null);
                add.reset();
              }}
            >
              {options.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
      </div>

      {admins.length === 0 ? (
        <EmptyState title={`No admins for this ${scope.type} yet.`} />
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
            {admins.map((admin) => {
              const name = rowName(admin);
              const mail = admin.email;
              return (
                <TableRow key={admin.oid}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span>{name}</span>
                      {mail && mail !== name ? (
                        <span className="text-muted-foreground text-xs">
                          {mail}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    {admin.source === "sso" ? (
                      <Badge variant="outline">Managed in Entra</Badge>
                    ) : (
                      <Badge variant="outline">Added here</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {admin.source === "ui" ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Revoke admin ${name}`}
                        onClick={() => {
                          revoke.reset();
                          setRevoking(admin);
                        }}
                      >
                        <Trash2 aria-hidden />
                      </Button>
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
            Add admin
          </Button>
        </div>
        {add.isError ? (
          <FormError>{accessErrorMessage(add.error)}</FormError>
        ) : null}
        {notice ? <FormStatus>{notice}</FormStatus> : null}
      </form>

      {revoking ? (
        <ConfirmDialog
          title="Revoke admin"
          description={`Revoke ${rowName(revoking)} as an admin of this ${revoking.scopeType}?`}
          confirmLabel="Revoke"
          pending={revoke.isPending}
          error={revoke.isError ? accessErrorMessage(revoke.error) : null}
          onConfirm={() => revoke.mutate(revoking)}
          onClose={() => setRevoking(null)}
        />
      ) : null}
    </div>
  );
}
