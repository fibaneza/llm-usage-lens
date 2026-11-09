"use client";

import type { AccountMeta } from "@bedrock-usage/shared";
import { Building2, Pencil, Plus, UserX } from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/display/EmptyState";
import {
  AddAccountDialog,
  DeactivateAccountDialog,
  EditAccountSheet,
} from "@/components/settings/AccountDialogs";
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

type Dialog =
  | { kind: "add" }
  | { kind: "edit"; account: AccountMeta }
  | { kind: "deactivate"; account: AccountMeta };

// Phase 4.9 account registry. Write controls render only for an Admin (the
// write Route Handlers enforce the role again — Rule 10.3, 50.4).
export function AccountRegistry({ isAdmin }: { isAdmin: boolean }) {
  const accounts = sectionData(useAccounts());
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const close = () => setDialog(null);

  if (accounts === undefined) return <Skeleton className="h-48 w-full" />;

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
                <TableHead>Account ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Team</TableHead>
                <TableHead>Status</TableHead>
                {isAdmin ? (
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((a) => (
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
