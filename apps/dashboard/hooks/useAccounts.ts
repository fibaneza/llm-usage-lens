"use client";

import { AccountListSchema } from "@bedrock-usage/shared";
import { useQuery } from "@tanstack/react-query";

import { fetchApi } from "@/lib/query/fetch-api";

export function useAccounts() {
  return useQuery({
    queryKey: ["accounts"],
    queryFn: () => fetchApi("/api/accounts", AccountListSchema),
  });
}
