"use client";

import {
  MeResponseSchema,
  UsersListResponseSchema,
  type UsersListRow,
} from "@llm-usage-lens/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";

import { ResetMemberSpendDialog } from "@/components/litellm/ResetMemberSpendDialog";
import { Empty, Unavailable } from "@/components/litellm/LiteLLMSection";
import { useLiteLLMQueryState } from "@/components/litellm/use-litellm-query";
import { UserDetail, budget, spend } from "@/components/litellm/UserSearch";
import { LiteLLMReportedBadge } from "@/components/litellm/LiteLLMReportedBadge";
import { LiteLLMLinkCell } from "@/components/manage/users/LiteLLMLinkCell";
import type { LinkState } from "@/components/manage/users/LiteLLMLinkCell";
import { useOrgUnits } from "@/components/settings/access/access-queries";
import { NativeSelect } from "@/components/settings/access/form-controls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useIsMobile } from "@/hooks/use-mobile";
import { ApiRequestError, fetchApi } from "@/lib/query/fetch-api";

// Source: Design System - Management improvements, LiteLLM users tab (D16a)
// and User link states (D16); LiteLLM spec - Views as Management routes
// (users tab). All users pages through LiteLLM on the server, 25 a page;
// Members of one team lists the app team's members. "Not in LiteLLM" is never
// a $0 row, and per-user cost is absent under the Organisation cap (LD23).
// The link controls render when the list response says mayLink, never on the caller's own
// row; the routes decide every write (Access Control - LiteLLM user links).
const MIN_TERM = 2;
const MAX_TERM = 100;
const DEBOUNCE_MS = 500;
const PAGE_SIZE = 25;
const NOT_IN_LITELLM = "Not in LiteLLM";

type Mode = "all" | "team";

function linkStateOf(row: UsersListRow): LinkState | null {
  const user = row.litellmUser;
  if (row.linkState === "linked" && user) {
    return { state: "linked", litellmUserId: user.userId };
  }
  if (row.linkState === "match" && user) {
    return { state: "match", litellmUserId: user.userId, email: user.email };
  }
  return row.linkState === "none" ? { state: "none" } : null;
}

function useCaller() {
  const me = useQuery({
    queryKey: ["me", "identity"],
    queryFn: () => fetchApi("/api/me", MeResponseSchema),
    retry: false,
  });
  return { oid: me.data?.oid ?? null };
}

function RowLink({
  row,
  mayLink,
  ownOid,
  canCreate,
  onChanged,
}: {
  row: UsersListRow;
  mayLink: boolean;
  ownOid: string | null;
  canCreate: boolean;
  onChanged: () => void;
}) {
  const state = linkStateOf(row);
  if (!state || !row.appUser) {
    return (
      <span className="text-muted-foreground text-sm">
        Not linked to an app user
      </span>
    );
  }
  const name = row.appUser.displayName ?? row.appUser.email ?? row.appUser.oid;
  return (
    <LiteLLMLinkCell
      subject={{
        oid: row.appUser.oid,
        name,
        email: row.appUser.email,
        version: row.appUser.version,
      }}
      link={state}
      canWrite={mayLink && ownOid !== null && row.appUser.oid !== ownOid}
      canCreate={canCreate}
      onChanged={onChanged}
    />
  );
}

// RS1 (D4): only where the Team page would show it - the toggle is on, the
// caller may write (mayLink) and the row has an app identity and a LiteLLM user.
function RowReset({ row, show }: { row: UsersListRow; show: boolean }) {
  if (!show || !row.appUser || !row.litellmUser) return null;
  return (
    <ResetMemberSpendDialog
      oid={row.appUser.oid}
      litellmUserId={row.litellmUser.userId}
      name={row.appUser.displayName ?? row.appUser.email ?? row.appUser.oid}
    />
  );
}

function List({
  mode,
  team,
  term,
  page,
  onPage,
  selected,
  onSelect,
}: {
  mode: Mode;
  team: string;
  term: string;
  page: number;
  onPage: (page: number) => void;
  selected: string | null;
  onSelect: (userId: string) => void;
}) {
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const caller = useCaller();
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(PAGE_SIZE),
  });
  if (mode === "team") params.set("team", team);
  if (term) params.set("q", term);
  const query = useLiteLLMQueryState(
    ["users-list", mode, team, term, String(page)],
    `/api/litellm/users?${params.toString()}`,
    UsersListResponseSchema,
  );
  if (mode === "team" && team === "") {
    return <Empty>Choose a team to list its members</Empty>;
  }
  if (query.isPending) return <Skeleton className="h-24 w-full" />;
  if (query.isError) {
    const error = query.error;
    return (
      <p role="alert" className="text-destructive text-sm">
        {error instanceof ApiRequestError || error instanceof Error
          ? error.message
          : "Could not load users."}
      </p>
    );
  }
  if (query.data.status === "unavailable") return <Unavailable />;
  const { users, hasMore, enabledOperations, mayLink } = query.data.data;
  if (users.length === 0 && page === 1) return <Empty>No users found</Empty>;
  const canCreate = enabledOperations.includes("createUser");
  const canReset =
    mayLink === true && enabledOperations.includes("resetMemberSpend");
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: ["litellm", "users-list"] });

  const cells = (row: UsersListRow) => {
    const user = row.litellmUser;
    const name =
      row.appUser?.displayName ?? row.appUser?.email ?? user?.email ?? "-";
    return {
      name,
      email: row.appUser?.email ?? user?.email ?? "-",
      // Never $0: a person with no LiteLLM user has no spend.
      spend: user ? spend(user.spend) : NOT_IN_LITELLM,
      budget: user ? budget(user.maxBudget) : NOT_IN_LITELLM,
      teams: user ? user.teams.map((t) => t.teamName).join(", ") || "-" : "-",
    };
  };
  const nameOf = (row: UsersListRow, text: string) =>
    row.litellmUser ? (
      <button
        type="button"
        className="focus-visible:ring-ring rounded-sm text-left font-medium underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:outline-none"
        onClick={() => onSelect(row.litellmUser?.userId ?? "")}
      >
        {text}
      </button>
    ) : (
      <span className="font-medium">{text}</span>
    );

  return (
    <div className="flex flex-col gap-3">
      <LiteLLMReportedBadge />
      {isMobile ? (
        <ul role="list" aria-label="LiteLLM users" className="space-y-3">
          {users.map((row) => {
            const c = cells(row);
            return (
              <li
                key={row.key}
                data-state={
                  row.litellmUser?.userId === selected ? "selected" : undefined
                }
                className="bg-card text-card-foreground rounded-card data-[state=selected]:border-ring space-y-3 border p-4"
              >
                {nameOf(row, c.name)}
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div className="col-span-2 min-w-0">
                    <dt className="text-muted-foreground text-xs">Email</dt>
                    <dd className="break-all">{c.email}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-muted-foreground text-xs">Spend</dt>
                    <dd className="font-mono break-words tabular-nums">
                      {c.spend}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-muted-foreground text-xs">Budget</dt>
                    <dd className="font-mono break-words tabular-nums">
                      {c.budget}
                    </dd>
                  </div>
                  <div className="col-span-2 min-w-0">
                    <dt className="text-muted-foreground text-xs">Teams</dt>
                    <dd className="break-words">{c.teams}</dd>
                  </div>
                </dl>
                <div className="flex flex-wrap items-center gap-2">
                  <RowLink
                    row={row}
                    mayLink={mayLink}
                    ownOid={caller.oid}
                    canCreate={canCreate}
                    onChanged={refresh}
                  />
                  <RowReset row={row} show={canReset} />
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <Table>
          <TableCaption className="sr-only">LiteLLM users</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Email</TableHead>
              <TableHead className="text-right">Spend</TableHead>
              <TableHead className="text-right">Budget</TableHead>
              <TableHead>Teams</TableHead>
              <TableHead>Link</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((row) => {
              const c = cells(row);
              return (
                <TableRow
                  key={row.key}
                  data-state={
                    row.litellmUser?.userId === selected
                      ? "selected"
                      : undefined
                  }
                >
                  <TableCell>{nameOf(row, c.name)}</TableCell>
                  <TableCell className="break-all">{c.email}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {c.spend}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {c.budget}
                  </TableCell>
                  <TableCell>{c.teams}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      <RowLink
                        row={row}
                        mayLink={mayLink}
                        ownOid={caller.oid}
                        canCreate={canCreate}
                        onChanged={refresh}
                      />
                      <RowReset row={row} show={canReset} />
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </Button>
        <span className="text-muted-foreground text-sm">Page {page}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!hasMore}
          onClick={() => onPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

export function LiteLLMUsersList() {
  const modeName = useId();
  const searchId = useId();
  const teamId = useId();
  const units = useOrgUnits();
  const [mode, setMode] = useState<Mode>("all");
  const [team, setTeam] = useState("");
  const [input, setInput] = useState("");
  const [term, setTerm] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      const trimmed = input.trim();
      setTerm(trimmed.length >= MIN_TERM ? trimmed : "");
      setPage(1);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm font-medium">Show</legend>
          <div className="flex gap-4">
            {(
              [
                ["all", "All users"],
                ["team", "Members of one team"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={modeName}
                  checked={mode === value}
                  onChange={() => {
                    setMode(value);
                    setPage(1);
                  }}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        {mode === "team" ? (
          <div className="flex min-w-48 flex-col gap-1">
            <label htmlFor={teamId} className="text-sm font-medium">
              Team
            </label>
            <NativeSelect
              id={teamId}
              value={team}
              onChange={(e) => {
                setTeam(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Choose a team</option>
              {(units.data?.teams ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : null}
        <div className="flex max-w-[72ch] min-w-48 flex-1 flex-col gap-1">
          <label htmlFor={searchId} className="text-sm font-medium">
            Search users
          </label>
          <Input
            id={searchId}
            type="search"
            maxLength={MAX_TERM}
            placeholder="Email or user id"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </div>
      </div>
      <List
        mode={mode}
        team={team}
        term={term}
        page={page}
        onPage={setPage}
        selected={selected}
        onSelect={setSelected}
      />
      {selected !== null ? <UserDetail userId={selected} /> : null}
    </div>
  );
}
