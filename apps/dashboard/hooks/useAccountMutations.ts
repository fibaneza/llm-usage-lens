"use client";

import {
  AccountMetaSchema,
  type CreateAccountInput,
  type UpdateAccountPatch,
} from "@llm-usage-lens/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { mutateApi } from "@/lib/query/fetch-api";

// Settings CRUD goes through the /api/accounts Route Handlers (Rule 60.15);
// each success invalidates the registry list.
function useInvalidateAccounts() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: ["accounts"] });
}

export function useCreateAccount() {
  const invalidate = useInvalidateAccounts();
  return useMutation({
    mutationFn: (input: CreateAccountInput) =>
      mutateApi("/api/accounts", "POST", input, AccountMetaSchema),
    onSuccess: invalidate,
  });
}

export function useUpdateAccount(accountId: string) {
  const invalidate = useInvalidateAccounts();
  return useMutation({
    mutationFn: (patch: UpdateAccountPatch) =>
      mutateApi(
        `/api/accounts/${accountId}`,
        "PATCH",
        patch,
        AccountMetaSchema,
      ),
    onSuccess: invalidate,
  });
}

export function useDeactivateAccount(accountId: string) {
  const invalidate = useInvalidateAccounts();
  return useMutation({
    mutationFn: () =>
      mutateApi(
        `/api/accounts/${accountId}`,
        "DELETE",
        undefined,
        AccountMetaSchema,
      ),
    onSuccess: invalidate,
  });
}
