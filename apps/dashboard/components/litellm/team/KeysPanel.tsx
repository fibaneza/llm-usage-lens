"use client";

import {
  LiteLLMKeysResponseSchema,
  LiteLLMMembersResponseSchema,
} from "@llm-usage-lens/shared";
import { useRef, useState, type RefObject } from "react";

import { ClientOnly } from "@/components/litellm/ClientOnly";
import { formatUsd } from "@/components/charts/chart-data";
import { Badge } from "@/components/ui/badge";
import { useIsMobile } from "@/hooks/use-mobile";
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

// `returnFocusRef` is the button that opened the dialog: Generate key, or the
// row's Rotate (disabled while its write runs, so Radix cannot restore focus).
type ShownKey = {
  value: string;
  returnFocusRef: RefObject<HTMLElement | null>;
};

const keyValueOf = (data: Record<string, unknown>) =>
  typeof data.key === "string" ? data.key : null;

function GenerateKey({
  teamId,
  onIssued,
  triggerRef,
}: {
  teamId: string;
  onIssued: (value: string) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
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
      triggerRef={triggerRef}
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

// One action block for a key row, shared by the table and the card layouts.
function KeyActions({
  teamId,
  tokenId,
  alias,
  ops,
  pending,
  write,
  refresh,
  onIssued,
}: {
  teamId: string;
  tokenId: string;
  alias: string;
  ops: ReadonlySet<string>;
  pending: boolean;
  write: ReturnType<typeof useTeamWrite>["write"];
  refresh: ReturnType<typeof useTeamWrite>["refresh"];
  onIssued: (shown: ShownKey) => void;
}) {
  const rotateRef = useRef<HTMLButtonElement>(null);
  const act = (action: string) =>
    write(keyPath(teamId, tokenId, action), "POST", undefined, ["keys"]);
  return (
    <span className="flex flex-wrap gap-2">
      {ops.has("updateMemberKey") ? (
        <EditKey teamId={teamId} tokenId={tokenId} alias={alias} />
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
          triggerRef={rotateRef}
          label={`Rotate key ${alias}`}
          text="Rotate"
          title={`Rotate ${alias}?`}
          description="A new key is issued and shown once."
          disabled={pending}
          onConfirm={() =>
            void write(keyPath(teamId, tokenId, "/rotate"), "POST", {}, [], {
              refetch: false,
            }).then((result) => {
              const value = result.ok ? keyValueOf(result.data) : null;
              if (value) onIssued({ value, returnFocusRef: rotateRef });
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
            void write(keyPath(teamId, tokenId), "DELETE", undefined, ["keys"])
          }
        />
      ) : null}
    </span>
  );
}

function KeysPanelContent({ teamId }: TeamPanelProps) {
  const detail = useTeamDetail(teamId);
  const keys = useLiteLLMQuery(
    ["team", teamId, "keys"],
    teamPath(teamId, "/keys"),
    LiteLLMKeysResponseSchema,
  );
  const { write, refresh, pending, error } = useTeamWrite(teamId);
  const [shown, setShown] = useState<ShownKey | null>(null);
  const generateRef = useRef<HTMLButtonElement>(null);
  const isMobile = useIsMobile();
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
  const actionProps = (key: { tokenId: string }, alias: string) => ({
    teamId,
    tokenId: key.tokenId,
    alias,
    ops,
    pending,
    write,
    refresh,
    onIssued: setShown,
  });

  return (
    <div className="flex flex-col gap-3">
      {ops.has("generateMemberKey") ? (
        <div>
          <GenerateKey
            teamId={teamId}
            onIssued={(value) =>
              setShown({ value, returnFocusRef: generateRef })
            }
            triggerRef={generateRef}
          />
        </div>
      ) : null}
      <WriteError message={error} />
      {shown ? (
        <ShownOnceKeyDialog
          value={shown.value}
          returnFocusRef={shown.returnFocusRef}
          onClose={() => {
            setShown(null);
            void refresh(["keys"]);
          }}
        />
      ) : null}
      {items.length === 0 ? (
        <Empty>No keys for this team.</Empty>
      ) : isMobile ? (
        <ul role="list" aria-label="Team keys" className="space-y-3">
          {items.map((key) => {
            const alias = key.keyAlias ?? `…${key.tokenId.slice(-4)}`;
            return (
              <li
                key={key.tokenId}
                className="bg-card text-card-foreground rounded-card space-y-3 border p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2 font-medium break-words">
                    <span>{alias}</span>
                    {key.blocked ? (
                      <Badge variant="outline">Blocked</Badge>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-base font-semibold">
                    <span className="sr-only">Spend</span>
                    <span className="font-mono tabular-nums">
                      {formatUsd(key.spend)}
                    </span>
                  </div>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div className="min-w-0">
                    <dt className="text-muted-foreground text-xs">Budget</dt>
                    <dd className="font-mono tabular-nums">
                      {key.maxBudget === null
                        ? "No limit"
                        : formatUsd(key.maxBudget)}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-muted-foreground text-xs">Expires</dt>
                    <dd>{formatSydneyTime(key.expires)}</dd>
                  </div>
                </dl>
                <KeyActions {...actionProps(key, alias)} />
              </li>
            );
          })}
        </ul>
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
                    <KeyActions {...actionProps(key, alias)} />
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

export function KeysPanel(props: TeamPanelProps) {
  return (
    <ClientOnly>
      <KeysPanelContent {...props} />
    </ClientOnly>
  );
}
