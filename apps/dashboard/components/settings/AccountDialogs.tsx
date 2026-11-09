"use client";

import {
  COLLECTOR_REGION,
  CreateAccountInputSchema,
  UpdateAccountPatchSchema,
  type AccountMeta,
  type UpdateAccountPatch,
} from "@bedrock-usage/shared";

import {
  AccountForm,
  EMPTY_ACCOUNT_VALUES,
  type AccountFormValues,
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
import {
  useCreateAccount,
  useDeactivateAccount,
  useUpdateAccount,
} from "@/hooks/useAccountMutations";
import { ApiRequestError } from "@/lib/query/fetch-api";

type CloseProps = { onClose: () => void };

function errorMessage(error: Error | null): string | null {
  if (!error) return null;
  return error instanceof ApiRequestError
    ? error.message
    : "Request failed — try again";
}

export function AddAccountDialog({ onClose }: CloseProps) {
  const create = useCreateAccount();
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
          schema={CreateAccountInputSchema.omit({ region: true })}
          submitLabel="Create account"
          pending={create.isPending}
          serverError={errorMessage(create.error)}
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

const EDITABLE_KEYS = [
  "accountName",
  "departmentId",
  "departmentName",
  "teamId",
  "teamName",
] as const;

export function EditAccountSheet({
  account,
  onClose,
}: CloseProps & { account: AccountMeta }) {
  const update = useUpdateAccount(account.accountId);
  const initial: AccountFormValues = {
    accountId: account.accountId,
    accountName: account.accountName,
    departmentId: account.departmentId,
    departmentName: account.departmentName,
    teamId: account.teamId,
    teamName: account.teamName,
  };

  function submit(values: AccountFormValues) {
    const patch: UpdateAccountPatch = {};
    for (const key of EDITABLE_KEYS) {
      if (values[key] !== account[key]) patch[key] = values[key];
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
