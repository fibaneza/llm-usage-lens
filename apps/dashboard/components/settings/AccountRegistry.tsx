"use client";

import type { AccountMeta } from "@llm-usage-lens/shared";
import { Building2, Pencil, Plus, UserX } from "lucide-react";
import { useQueryStates } from "nuqs";
import { useState } from "react";

import { EmptyState } from "@/components/display/EmptyState";
import {
  AddAccountDialog,
  DeactivateAccountDialog,
  EditAccountSheet,
} from "@/components/settings/AccountDialogs";
import {
  SORT_PARAMS,
  SortableHeader,
  readSort,
} from "@/components/tables/SortableHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAccounts } from "@/hooks/useAccounts";
import { sectionData } from "@/lib/query/section-data";

const SORT_KEYS = [
  "accountId",
  "name",
  "department",
  "team",
  "status",
] as const;

type Dialog =
  | { kind: "add" }
  | { kind: "edit"; account: AccountMeta }
  | { kind: "deactivate"; account: AccountMeta };

// Phase 4.9 account registry. Write controls render only for an Admin (the
// write Route Handlers enforce the role again — Rule 10.3, 50.4).
export function AccountRegistry({ isAdmin }: { isAdmin: boolean }) {
  const accounts = sectionData(useAccounts());
  const [params] = useQueryStates(SORT_PARAMS);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const close = () => setDialog(null);

  if (accounts === undefined) return <Skeleton className="h-48 w-full" />;

  const { key, dir } = readSort(params.sort, params.dir, "", SORT_KEYS);
  const sign = dir === "asc" ? 1 : -1;
  const sorted = key
    ? [...accounts].sort((a, b) => {
        if (key === "status")
          return sign * (Number(!a.active) - Number(!b.active));
        const [x, y] =
          key === "accountId"
            ? [a.accountId, b.accountId]
            : key === "name"
              ? [a.accountName, b.accountName]
              : key === "department"
                ? [a.departmentName, b.departmentName]
                : [a.teamName, b.teamName];
        return sign * x.localeCompare(y);
      })
    : accounts;

  const addButton = isAdmin ? (
    <Button type="button" size="sm" onClick={() => setDialog({ kind: "add" })}>
      <Plus aria-hidden />
      Add account
    </Button>
  ) : null;

  return (
    <div className="flex flex-col gap-4">
      {accounts.length > 0 ? (
        <>
          {addButton ? (
            <div className="flex justify-end">{addButton}</div>
          ) : null}
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHeader sortKey="accountId" sortKeys={SORT_KEYS}>
                  Account ID
                </SortableHeader>
                <SortableHeader sortKey="name" sortKeys={SORT_KEYS}>
                  Name
                </SortableHeader>
                <SortableHeader sortKey="department" sortKeys={SORT_KEYS}>
                  Department
                </SortableHeader>
                <SortableHeader sortKey="team" sortKeys={SORT_KEYS}>
                  Team
                </SortableHeader>
                <SortableHeader sortKey="status" sortKeys={SORT_KEYS}>
                  Status
                </SortableHeader>
                {isAdmin ? (
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((a) => (
                <TableRow key={a.accountId}>
                  <TableCell className="font-mono">{a.accountId}</TableCell>
                  <TableCell>{a.accountName}</TableCell>
                  <TableCell>{a.departmentName}</TableCell>
                  <TableCell>{a.teamName}</TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {a.active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  {isAdmin ? (
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Edit ${a.accountName}`}
                          onClick={() =>
                            setDialog({ kind: "edit", account: a })
                          }
                        >
                          <Pencil aria-hidden />
                        </Button>
                        {a.active ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`Deactivate ${a.accountName}`}
                            onClick={() =>
                              setDialog({ kind: "deactivate", account: a })
                            }
                          >
                            <UserX aria-hidden />
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      ) : (
        <EmptyState
          icon={Building2}
          title="No accounts registered"
          description={
            isAdmin ? "Add an account to start collecting." : undefined
          }
          action={addButton}
        />
      )}

      {dialog?.kind === "add" ? <AddAccountDialog onClose={close} /> : null}
      {dialog?.kind === "edit" ? (
        <EditAccountSheet account={dialog.account} onClose={close} />
      ) : null}
      {dialog?.kind === "deactivate" ? (
        <DeactivateAccountDialog account={dialog.account} onClose={close} />
      ) : null}
    </div>
  );
}
