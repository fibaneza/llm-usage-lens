"use client";

import {
  LiteLLMKeysResponseSchema,
  LiteLLMMembersResponseSchema,
} from "@llm-usage-lens/shared";
import { useState } from "react";

import { formatUsd } from "@/components/charts/chart-data";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { Empty, NotConnected, Unavailable } from "../LiteLLMSection";
import { formatSydneyTime } from "../sydney-time";
import type { TeamPanelProps } from "./panel-props";
import { NativeSelect } from "./native-select";
import { ShownOnceKeyDialog } from "./shown-once-key-dialog";
import {
  ActionButton,
  ConfirmAction,
  FormDialog,
  WriteError,
} from "./write-parts";
import { useLiteLLMQuery, useLiteLLMQueryState } from "../use-litellm-query";
import { useTeamDetail } from "../use-team-detail";
import { keyPath, teamPath, useTeamWrite } from "./use-team-write";

type ShownKey = { value: string };

const keyValueOf = (data: Record<string, unknown>) =>
  typeof data.key === "string" ? data.key : null;

function GenerateKey({
  teamId,
  onIssued,
}: {
  teamId: string;
  onIssued: (value: string) => void;
}) {
  const { write, pending, error, clearError } = useTeamWrite(teamId);
  // Same cache entry as the Members section; a failed read only empties the
  // owner list.
  const members = useLiteLLMQueryState(
    ["team", teamId, "members"],
    teamPath(teamId, "/members"),
    LiteLLMMembersResponseSchema,
  );
  const [oid, setOid] = useState("");
  const [alias, setAlias] = useState("");
  const owners = (
    members.data?.status === "ok" ? members.data.data.items : []
  ).filter((m): m is typeof m & { oid: string } => m.oid !== undefined);
  return (
    <FormDialog
      label="Generate key"
      text="Generate key"
      title="Generate key"
      description="Create a key for a member of this team."
      submitLabel="Generate"
      canSubmit={oid !== ""}
      pending={pending}
      error={error}
      onOpen={clearError}
      onSubmit={async () => {
        const result = await write(
          teamPath(teamId, "/keys"),
          "POST",
          { oid, ...(alias.trim() ? { keyAlias: alias.trim() } : {}) },
          [],
          { refetch: false },
        );
        if (!result.ok) return false;
        const value = keyValueOf(result.data);
        if (value) onIssued(value);
        setOid("");
        setAlias("");
        return true;
      }}
    >
      <label className="grid gap-1 text-sm font-medium">
        Key owner
        <NativeSelect
          aria-label="Key owner"
          value={oid}
          onChange={(e) => setOid(e.target.value)}
        >
          <option value="">Choose a member</option>
          {owners.map((m) => (
            <option key={m.oid} value={m.oid}>
              {m.name ?? m.email}
            </option>
          ))}
        </NativeSelect>
      </label>
      <label className="grid gap-1 text-sm font-medium">
        Key alias
        <Input value={alias} onChange={(e) => setAlias(e.target.value)} />
      </label>
    </FormDialog>
  );
}

function EditKey({
  teamId,
  tokenId,
  alias,
}: {
  teamId: string;
  tokenId: string;
  alias: string;
}) {
  const { write, pending, error, clearError } = useTeamWrite(teamId);
  const [budget, setBudget] = useState("");
  return (
    <FormDialog
      label={`Edit key ${alias}`}
      text="Edit"
      title={`Edit key ${alias}`}
      submitLabel="Save"
      canSubmit={budget.trim() !== ""}
      pending={pending}
      error={error}
      onOpen={clearError}
      onSubmit={async () => {
        const result = await write(
          keyPath(teamId, tokenId),
          "PATCH",
          { maxBudget: Number(budget) },
          ["keys"],
        );
        if (result.ok) setBudget("");
        return result.ok;
      }}
    >
      <label className="grid gap-1 text-sm font-medium">
        Key budget (USD)
        <Input
          type="number"
          min={0}
          step="any"
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
        />
      </label>
    </FormDialog>
  );
}

export function KeysPanel({ teamId }: TeamPanelProps) {
  const detail = useTeamDetail(teamId);
  const keys = useLiteLLMQuery(
    ["team", teamId, "keys"],
    teamPath(teamId, "/keys"),
    LiteLLMKeysResponseSchema,
  );
  const { write, refresh, pending, error } = useTeamWrite(teamId);
  const [shown, setShown] = useState<ShownKey | null>(null);
  if (detail.status === "unavailable" || keys.status === "unavailable") {
    return <Unavailable />;
  }
  if (
    detail.data.configured === false ||
    !detail.data.connected ||
    !keys.data.connected
  )
    return <NotConnected />;
  const ops = new Set(detail.data.enabledOperations);
  const { items } = keys.data;

  return (
    <div className="flex flex-col gap-3">
      {ops.has("generateMemberKey") ? (
        <div>
          <GenerateKey
            teamId={teamId}
            onIssued={(value) => setShown({ value })}
          />
        </div>
      ) : null}
      <WriteError message={error} />
      {shown ? (
        <ShownOnceKeyDialog
          value={shown.value}
          onClose={() => {
            setShown(null);
            void refresh(["keys"]);
          }}
        />
      ) : null}
      {items.length === 0 ? (
        <Empty>No keys for this team.</Empty>
      ) : (
        <Table>
          <TableCaption className="sr-only">Team keys</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Key</TableHead>
              <TableHead className="text-right">Spend</TableHead>
              <TableHead className="text-right">Budget</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((key) => {
              const alias = key.keyAlias ?? `…${key.tokenId.slice(-4)}`;
              const act = (action: string) =>
                write(keyPath(teamId, key.tokenId, action), "POST", undefined, [
                  "keys",
                ]);
              return (
                <TableRow key={key.tokenId}>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      <span>{alias}</span>
                      {key.blocked ? (
                        <Badge variant="outline">Blocked</Badge>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatUsd(key.spend)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {key.maxBudget === null
                      ? "No limit"
                      : formatUsd(key.maxBudget)}
                  </TableCell>
                  <TableCell>{formatSydneyTime(key.expires)}</TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-2">
                      {ops.has("updateMemberKey") ? (
                        <EditKey
                          teamId={teamId}
                          tokenId={key.tokenId}
                          alias={alias}
                        />
                      ) : null}
                      {ops.has("blockKey") ? (
                        <ActionButton
                          label={`Block key ${alias}`}
                          text="Block"
                          disabled={pending}
                          onClick={() => void act("/block")}
                        />
                      ) : null}
                      {ops.has("unblockKey") ? (
                        <ActionButton
                          label={`Unblock key ${alias}`}
                          text="Unblock"
                          disabled={pending}
                          onClick={() => void act("/unblock")}
                        />
                      ) : null}
                      {ops.has("rotateKey") ? (
                        <ConfirmAction
                          label={`Rotate key ${alias}`}
                          text="Rotate"
                          title={`Rotate ${alias}?`}
                          description="A new key is issued and shown once."
                          disabled={pending}
                          onConfirm={() =>
                            void write(
                              keyPath(teamId, key.tokenId, "/rotate"),
                              "POST",
                              {},
                              [],
                              { refetch: false },
                            ).then((result) => {
                              const value = result.ok
                                ? keyValueOf(result.data)
                                : null;
                              if (value) setShown({ value });
                              else void refresh(["keys"]);
                            })
                          }
                        />
                      ) : null}
                      {ops.has("deleteKey") ? (
                        <ConfirmAction
                          label={`Delete key ${alias}`}
                          text="Delete"
                          title={`Delete ${alias}?`}
                          description="The key stops working immediately."
                          disabled={pending}
                          onConfirm={() =>
                            void write(
                              keyPath(teamId, key.tokenId),
                              "DELETE",
                              undefined,
                              ["keys"],
                            )
                          }
                        />
                      ) : null}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
