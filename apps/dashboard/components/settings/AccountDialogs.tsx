"use client";

import {
  COLLECTOR_REGION,
  AccountMetaSchema,
  CreateAccountRequestSchema,
  type CreateAccountRequest,
  UpdateAccountPatchSchema,
  type AccountMeta,
  type UpdateAccountPatch,
} from "@llm-usage-lens/shared";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  AccountForm,
  EMPTY_ACCOUNT_VALUES,
  type AccountFormValues,
  type AccountPickedIds,
  type RegistryPick,
} from "@/components/settings/AccountForm";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAccounts } from "@/hooks/useAccounts";
import {
  useDeactivateAccount,
  useUpdateAccount,
} from "@/hooks/useAccountMutations";
import { ApiRequestError, mutateApi } from "@/lib/query/fetch-api";

type CloseProps = { onClose: () => void };

function errorMessage(error: Error | null): string | null {
  if (!error) return null;
  return error instanceof ApiRequestError
    ? error.message
    : "Request failed — try again";
}

// The body carries names; the server generates departmentId and teamId (D-ST5).
function useCreateAccountRequest() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAccountRequest) =>
      mutateApi("/api/accounts", "POST", input, AccountMetaSchema),
    onSuccess: () => client.invalidateQueries({ queryKey: ["accounts"] }),
  });
}

function distinct(names: readonly string[]): string[] {
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

export function AddAccountDialog({ onClose }: CloseProps) {
  const create = useCreateAccountRequest();
  const accounts = useAccounts().data ?? [];
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add account</DialogTitle>
          <DialogDescription>
            Register an AWS account for the collector to read.
          </DialogDescription>
        </DialogHeader>
        <AccountForm
          initial={EMPTY_ACCOUNT_VALUES}
          schema={CreateAccountRequestSchema.omit({ region: true })}
          submitLabel="Create account"
          pending={create.isPending}
          serverError={errorMessage(create.error)}
          existingDepartments={distinct(accounts.map((a) => a.departmentName))}
          existingTeams={distinct(accounts.map((a) => a.teamName))}
          onSubmit={(values) =>
            create.mutate(
              { ...values, region: COLLECTOR_REGION },
              { onSuccess: onClose },
            )
          }
        />
      </DialogContent>
    </Dialog>
  );
}

function distinctPicks(
  rows: ReadonlyArray<{ id: string; name: string }>,
): RegistryPick[] {
  const byId = new Map(rows.map((r) => [r.id, r.name]));
  return [...byId]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function distinctTeamPicks(
  rows: ReadonlyArray<{ id: string; name: string; departmentId: string }>,
): RegistryPick[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function EditAccountSheet({
  account,
  onClose,
}: CloseProps & { account: AccountMeta }) {
  const update = useUpdateAccount(account.accountId);
  const accounts = useAccounts().data ?? [];
  const departments = distinctPicks([
    { id: account.departmentId, name: account.departmentName },
    ...accounts.map((a) => ({ id: a.departmentId, name: a.departmentName })),
  ]);
  const teams = distinctTeamPicks([
    {
      id: account.teamId,
      name: account.teamName,
      departmentId: account.departmentId,
    },
    ...accounts.map((a) => ({
      id: a.teamId,
      name: a.teamName,
      departmentId: a.departmentId,
    })),
  ]);
  const initial: AccountFormValues = {
    accountId: account.accountId,
    accountName: account.accountName,
    departmentName: account.departmentName,
    teamName: account.teamName,
  };

  function submit(values: AccountFormValues, ids?: AccountPickedIds) {
    const patch: UpdateAccountPatch = {};
    if (values.accountName !== account.accountName) {
      patch.accountName = values.accountName;
    }
    if (ids && ids.departmentId !== account.departmentId) {
      patch.departmentId = ids.departmentId;
      patch.departmentName = values.departmentName;
    }
    if (ids && ids.teamId !== account.teamId) {
      patch.teamId = ids.teamId;
      patch.teamName = values.teamName;
    }
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    update.mutate(patch, { onSuccess: onClose });
  }

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Edit account</SheetTitle>
          <SheetDescription>
            The account ID is fixed once an account is registered.
          </SheetDescription>
        </SheetHeader>
        <div className="overflow-y-auto px-4 pb-4">
          <AccountForm
            initial={initial}
            schema={UpdateAccountPatchSchema}
            submitLabel="Save changes"
            accountIdReadOnly
            registryDepartments={departments}
            registryTeams={teams}
            initialIds={{
              departmentId: account.departmentId,
              teamId: account.teamId,
            }}
            pending={update.isPending}
            serverError={errorMessage(update.error)}
            onSubmit={submit}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function DeactivateAccountDialog({
  account,
  onClose,
}: CloseProps & { account: AccountMeta }) {
  const deactivate = useDeactivateAccount(account.accountId);
  const error = errorMessage(deactivate.error);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Deactivate account</DialogTitle>
          <DialogDescription>
            {`Deactivate ${account.accountName}? The collector stops reading it; its history is kept.`}
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={deactivate.isPending}
            onClick={() => deactivate.mutate(undefined, { onSuccess: onClose })}
          >
            Deactivate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
