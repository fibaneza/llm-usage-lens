"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";

import { ApiRequestError, mutateApi } from "@/lib/query/fetch-api";

export type TeamRead = "detail" | "members" | "keys";

export type WriteResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false };

const WriteDataSchema = z.record(z.string(), z.unknown());

const base = (teamId: string) =>
  `/api/litellm/teams/${encodeURIComponent(teamId)}`;

export const memberPath = (teamId: string, oid: string, action = "") =>
  `${base(teamId)}/members/${encodeURIComponent(oid)}${action}`;
export const keyPath = (teamId: string, tokenId: string, action = "") =>
  `${base(teamId)}/keys/${encodeURIComponent(tokenId)}${action}`;
export const teamPath = (teamId: string, action: string) =>
  `${base(teamId)}${action}`;

// One write at a time per surface: failures keep the server message (the
// routes' error codes, LiteLLM spec -- API routes) for an inline role="alert"
// and a successful write refetches the reads it changed. Nothing is stored in
// the query cache, so a one-time key value never outlives its dialog.
export function useTeamWrite(teamId: string) {
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function write(
    path: string,
    method: "POST" | "PUT" | "PATCH" | "DELETE",
    body: unknown,
    refresh: readonly TeamRead[],
    { refetch = true }: { refetch?: boolean } = {},
  ): Promise<WriteResult> {
    setError(null);
    setPending(true);
    try {
      const data = await mutateApi(path, method, body, WriteDataSchema);
      if (refetch) await refreshReads(teamId, refresh);
      return { ok: true, data };
    } catch (caught) {
      if (!(caught instanceof ApiRequestError)) throw caught;
      setError(caught.message);
      return { ok: false };
    } finally {
      setPending(false);
    }
  }

  async function refreshReads(id: string, reads: readonly TeamRead[]) {
    await Promise.all(
      reads.map((read) =>
        client.invalidateQueries({
          queryKey:
            read === "detail"
              ? ["litellm", "team", id]
              : ["litellm", "team", id, read],
          exact: true,
        }),
      ),
    );
  }

  return {
    write,
    refresh: (reads: readonly TeamRead[]) => refreshReads(teamId, reads),
    error,
    pending,
    clearError: () => setError(null),
  };
}
