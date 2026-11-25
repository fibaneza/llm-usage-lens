"use client";

import {
  LiteLLMOrgResponseSchema,
  LiteLLMProxyTeamMembersResponseSchema,
  LiteLLMUserSearchResponseSchema,
  MeResponseSchema,
  UsersListResponseSchema,
  type UsersListRow,
} from "@llm-usage-lens/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useQueryStates } from "nuqs";
import { useEffect, useId, useState } from "react";
import type { ReactNode } from "react";

import { ResetMemberSpendDialog } from "@/components/litellm/ResetMemberSpendDialog";
import { Empty, Unavailable } from "@/components/litellm/LiteLLMSection";
import {
  useLiteLLMQueryState,
  useUrlRange,
} from "@/components/litellm/use-litellm-query";
import { budget, spend } from "@/components/litellm/proxy-user/user-figures";
import { LiteLLMReportedBadge } from "@/components/litellm/LiteLLMReportedBadge";
import { LiteLLMLinkCell } from "@/components/manage/users/LiteLLMLinkCell";
import type { LinkState } from "@/components/manage/users/LiteLLMLinkCell";
import {
  SORT_PARAMS,
  SortableHeader,
  readSort,
} from "@/components/tables/SortableHeader";
import { NativeSelect } from "@/components/settings/access/form-controls";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/table/SearchInput";
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
// and User link states (D16), LF1 (D-LF1, D-LF3, D-LF4); LiteLLM spec - Views
// as Management routes (users tab). All users pages through LiteLLM on the
// server, 25 a page; a search answers the search shape, with no link data and
// no paging; Members of one team picks a LiteLLM team (linked: the app team's
// members; unlinked: the LiteLLM team's own members). "Not in LiteLLM" is
// never a $0 row, and per-user cost is absent under the Organisation cap (LD23).
// The user cell links to the LiteLLM user page (LP2, T-LP9); no detail opens here.
// The link controls render when the list response says mayLink, never on the caller's own
// row; the routes decide every write (Access Control - LiteLLM user links).
const MIN_TERM = 2;
const MAX_TERM = 100;
const DEBOUNCE_MS = 500;
const PAGE_SIZE = 25;
const NOT_IN_LITELLM = "Not in LiteLLM";

// Design System - "Sorting in the other tables (unit SRT1; D-SR1)": the server
// sorts by these keys; the URL value is checked against the list before it is
// sent. With no sort the page keeps LiteLLM's own order.
const SORT_KEYS = ["email", "spend"] as const;
const EMAIL_ONLY = ["email"] as const;
type Sort = { sort: string; dir: "asc" | "desc" } | null;

function useUsersSort(): Sort {
  const [params] = useQueryStates(SORT_PARAMS);
  const { key, dir } = readSort(params.sort, params.dir, "", SORT_KEYS);
  return key === "" ? null : { sort: key, dir };
}

// A capped caller who opens ?sort=spend gets a 400 (LD23): drop the sort so the
// list reloads in LiteLLM's own order instead of a dead error state.
function useDropRefusedSpendSort(query: { isError: boolean; error: unknown }) {
  const [params, setParams] = useQueryStates(SORT_PARAMS);
  const refused =
    query.isError &&
    query.error instanceof ApiRequestError &&
    query.error.status === 400 &&
    params.sort === "spend";
  useEffect(() => {
    if (refused) void setParams({ sort: null, dir: null });
  }, [refused, setParams]);
}

const sortQuery = (sort: Sort) =>
  sort ? `&sort=${sort.sort}&dir=${sort.dir}` : "";

type Mode = "all" | "team";

// A row as the views share it. `linkKnown` is false where the route carries no
// link data (a search answer, a LiteLLM team's own members); `label` overrides
// the name for a LiteLLM team member whose app person is known.
type ViewRow = UsersListRow & {
  linkKnown: boolean;
  label?: string;
  // A proxy-team member's app person, for the own-row check (appUser is null).
  personOid?: string;
};

type RowsState = {
  rows: ViewRow[];
  mayLink: boolean;
  enabledOperations: string[];
  proxyCanReset?: boolean;
  // The caller's own LiteLLM user id, for the own-row check on a search.
  callerLitellmUserId?: string | null;
  // Server-sorted views only; the proxy-team members view has no sort.
  sortable?: boolean;
  pager: {
    page: number;
    hasMore: boolean;
    onPage: (page: number) => void;
  } | null;
};

function linkStateOf(row: ViewRow): LinkState | null {
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
  row: ViewRow;
  mayLink: boolean;
  ownOid: string | null;
  canCreate: boolean;
  onChanged: () => void;
}) {
  const state = linkStateOf(row);
  if (!row.linkKnown || !state || !row.appUser) return null;
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
      showState={false}
    />
  );
}

// RS2 (D-RS7, supersedes RS1 D4): the resetUserSpend toggle is on, the caller
// may write (mayLink) and the row has a LiteLLM user, linked to an app user or not.
function RowReset({
  row,
  show,
  enabledOperations,
}: {
  row: UsersListRow;
  show: boolean;
  enabledOperations: string[];
}) {
  if (!show || !row.litellmUser) return null;
  const name =
    row.appUser?.displayName ?? row.appUser?.email ?? row.litellmUser.email;
  return (
    <ResetMemberSpendDialog
      {...(row.appUser ? { oid: row.appUser.oid } : {})}
      litellmUserId={row.litellmUser.userId}
      name={name}
      userReset
      enabledOperations={enabledOperations}
    />
  );
}

function nameOf(row: ViewRow): string {
  return (
    row.label ??
    row.appUser?.displayName ??
    row.appUser?.email ??
    row.litellmUser?.email ??
    "—"
  );
}

function RowName({ row }: { row: ViewRow }) {
  const text = nameOf(row);
  return row.litellmUser ? (
    <Link
      href={`/dashboard/manage/litellm/users/${encodeURIComponent(row.litellmUser.userId)}`}
      className="focus-visible:ring-ring rounded-sm text-left font-medium underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:outline-none"
    >
      {text}
    </Link>
  ) : (
    <span className="font-medium">{text}</span>
  );
}

function RowsView({
  state,
  ownOid,
}: {
  state: RowsState;
  ownOid: string | null;
}) {
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const {
    rows,
    mayLink,
    enabledOperations,
    pager,
    proxyCanReset,
    callerLitellmUserId,
    sortable,
  } = state;
  // LD23: with per-user cost hidden or capped no row carries spend, and the
  // server refuses sort=spend, so the header is not offered.
  const spendShown = rows.some((r) => r.litellmUser?.spend !== undefined);
  const sortKeys = spendShown ? SORT_KEYS : EMAIL_ONLY;
  const canCreate = enabledOperations.includes("createUser");
  const canReset =
    (mayLink || proxyCanReset === true) &&
    (enabledOperations.includes("resetMemberSpend") ||
      enabledOperations.includes("resetUserSpend"));
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: ["litellm", "users-list"] });

  const cells = (row: ViewRow) => {
    const user = row.litellmUser;
    const name = nameOf(row);
    const email = row.appUser?.email ?? user?.email ?? "—";
    return {
      name,
      email: email === name ? "—" : email,
      // Never $0: a person with no LiteLLM user has no spend.
      spend: user ? spend(user.spend) : NOT_IN_LITELLM,
      budget: user ? budget(user.maxBudget) : NOT_IN_LITELLM,
      teams: user ? user.teams.map((t) => t.teamName).join(", ") || "—" : "—",
    };
  };
  const isOwn = (row: ViewRow) => {
    const oid = row.appUser?.oid ?? row.personOid;
    if (ownOid !== null && oid === ownOid) return true;
    return (
      callerLitellmUserId != null &&
      row.litellmUser?.userId === callerLitellmUserId
    );
  };
  const actions = (row: ViewRow) => (
    <div className="flex flex-wrap items-center gap-2">
      <RowLink
        row={row}
        mayLink={mayLink}
        ownOid={ownOid}
        canCreate={canCreate}
        onChanged={refresh}
      />
      <RowReset
        row={row}
        show={canReset && !isOwn(row)}
        enabledOperations={enabledOperations}
      />
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      <LiteLLMReportedBadge />
      {isMobile ? (
        <ul role="list" aria-label="LiteLLM users" className="space-y-3">
          {rows.map((row) => {
            const c = cells(row);
            return (
              <li
                key={row.key}
                className="bg-card text-card-foreground rounded-card space-y-3 border p-4"
              >
                <RowName row={row} />
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
                {actions(row)}
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
              {sortable ? (
                <SortableHeader sortKey="email" sortKeys={sortKeys}>
                  Email
                </SortableHeader>
              ) : (
                <TableHead>Email</TableHead>
              )}
              {sortable && spendShown ? (
                <SortableHeader
                  sortKey="spend"
                  sortKeys={sortKeys}
                  className="text-right"
                >
                  Spend
                </SortableHeader>
              ) : (
                <TableHead className="text-right">Spend</TableHead>
              )}
              <TableHead className="text-right">Budget</TableHead>
              <TableHead>Teams</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const c = cells(row);
              return (
                <TableRow key={row.key}>
                  <TableCell>
                    <RowName row={row} />
                  </TableCell>
                  <TableCell className="break-all">{c.email}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {c.spend}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {c.budget}
                  </TableCell>
                  <TableCell>{c.teams}</TableCell>
                  <TableCell>{actions(row)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      {pager ? (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pager.page <= 1}
            onClick={() => pager.onPage(pager.page - 1)}
          >
            Previous
          </Button>
          <span className="text-muted-foreground text-sm">
            Page {pager.page}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!pager.hasMore}
            onClick={() => pager.onPage(pager.page + 1)}
          >
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// Pending, failed and unavailable answers, shared by the three views.
function queryNotice(query: {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  data?: { status: string } | undefined;
}): ReactNode {
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
  return query.data?.status === "ok" ? null : <Unavailable />;
}

type ViewProps = {
  // Read where the tab mounts, so it is known by the time rows render.
  ownOid: string | null;
  term: string;
  page: number;
  onPage: (page: number) => void;
};

// All users (no search) or one linked team's members: the list shape.
function ListView({
  team,
  ownOid,
  term,
  page,
  onPage,
}: ViewProps & { team: string | null }) {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(PAGE_SIZE),
  });
  if (team !== null) params.set("team", team);
  if (term) params.set("q", term);
  const sort = useUsersSort();
  const query = useLiteLLMQueryState(
    [
      "users-list",
      team ?? "all",
      term,
      String(page),
      sort?.sort ?? "",
      sort?.dir ?? "",
    ],
    `/api/litellm/users?${params.toString()}${sortQuery(sort)}`,
    UsersListResponseSchema,
  );
  useDropRefusedSpendSort(query);
  const notice = queryNotice(query);
  if (notice) return notice;
  if (query.data?.status !== "ok") return null;
  const { users, hasMore, enabledOperations, mayLink } = query.data.data;
  if (users.length === 0 && page === 1) return <Empty>No users found</Empty>;
  return (
    <RowsView
      state={{
        rows: users.map((u) => ({ ...u, linkKnown: true })),
        mayLink,
        enabledOperations,
        sortable: true,
        pager: { page, hasMore, onPage },
      }}
      ownOid={ownOid}
    />
  );
}

// All users with a search term: the search shape, with no link data and no
// paging (D-LF1).
function SearchView({ ownOid, term }: ViewProps) {
  const params = new URLSearchParams({ q: term, page: "1" });
  params.set("pageSize", String(PAGE_SIZE));
  const sort = useUsersSort();
  const query = useLiteLLMQueryState(
    ["users-list", "search", term, sort?.sort ?? "", sort?.dir ?? ""],
    `/api/litellm/users?${params.toString()}${sortQuery(sort)}`,
    LiteLLMUserSearchResponseSchema,
  );
  useDropRefusedSpendSort(query);
  const notice = queryNotice(query);
  if (notice) return notice;
  if (query.data?.status !== "ok") return null;
  const { users, enabledOperations, mayLink, callerLitellmUserId } =
    query.data.data;
  if (users.length === 0) return <Empty>No users found</Empty>;
  return (
    <RowsView
      state={{
        rows: users.map((u) => ({
          key: u.userId,
          linkState: "unlinked",
          appUser: null,
          litellmUser: u,
          linkKnown: false,
        })),
        mayLink,
        callerLitellmUserId,
        enabledOperations,
        sortable: true,
        pager: null,
      }}
      ownOid={ownOid}
    />
  );
}

// A LiteLLM team with no app team: its own members by LiteLLM id (RS2).
function ProxyTeamView({
  litellmTeamId,
  ownOid,
  term,
  canReset,
}: ViewProps & { litellmTeamId: string; canReset: boolean }) {
  const query = useLiteLLMQueryState(
    ["users-list", "proxy-team", litellmTeamId],
    `/api/litellm/proxy-teams/${encodeURIComponent(litellmTeamId)}/members`,
    LiteLLMProxyTeamMembersResponseSchema,
  );
  const notice = queryNotice(query);
  if (notice) return notice;
  if (query.data?.status !== "ok") return null;
  const { items, enabledOperations } = query.data.data;
  const needle = term.toLowerCase();
  const shown = items.filter(
    (m) =>
      needle === "" ||
      m.email.toLowerCase().includes(needle) ||
      m.userId.toLowerCase().includes(needle),
  );
  if (shown.length === 0) return <Empty>No users found</Empty>;
  return (
    <RowsView
      state={{
        rows: shown.map((m) => ({
          key: m.userId,
          linkState: "unlinked",
          appUser: null,
          litellmUser: {
            userId: m.userId,
            email: m.email,
            teams: [],
            ...(m.spend === undefined ? {} : { spend: m.spend }),
            ...(m.maxBudget === undefined ? {} : { maxBudget: m.maxBudget }),
          },
          linkKnown: false,
          ...(m.person
            ? { label: m.person.name, personOid: m.person.oid }
            : {}),
        })),
        // The members read carries no write flag: no link buttons; Reset spend
        // follows the page capability (LF1 F1).
        mayLink: false,
        proxyCanReset: canReset,
        enabledOperations,
        pager: null,
      }}
      ownOid={ownOid}
    />
  );
}

// D-LF3: the LiteLLM teams (linked or not), from the Organisation read.
function TeamMode({
  canReset,
  ...props
}: ViewProps & { onTeamChange: () => void; canReset: boolean }) {
  const teamId = useId();
  const [litellmTeamId, setLitellmTeamId] = useState("");
  const { keyParts, query: range } = useUrlRange();
  const org = useLiteLLMQueryState(
    ["users-team-picker", ...keyParts],
    `/api/litellm/org?${range}`,
    LiteLLMOrgResponseSchema,
  );
  const notice = queryNotice(org);
  if (notice) return notice;
  if (org.data?.status !== "ok") return null;
  const teams = org.data.data.litellmTeams;
  const chosen = teams.find((t) => t.litellmTeamId === litellmTeamId);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex min-w-48 flex-col gap-1">
        <label htmlFor={teamId} className="text-sm font-medium">
          Team
        </label>
        <NativeSelect
          id={teamId}
          value={litellmTeamId}
          onChange={(e) => {
            setLitellmTeamId(e.target.value);
            props.onTeamChange();
          }}
        >
          <option value="">Choose a team</option>
          {teams.map((t) => (
            <option key={t.litellmTeamId} value={t.litellmTeamId}>
              {t.alias ?? t.litellmTeamId}
            </option>
          ))}
        </NativeSelect>
      </div>
      {!chosen ? (
        <Empty>Choose a team to list its members</Empty>
      ) : chosen.linkedAppTeam ? (
        <ListView {...props} team={chosen.linkedAppTeam.teamId} />
      ) : (
        <ProxyTeamView
          {...props}
          litellmTeamId={chosen.litellmTeamId}
          canReset={canReset}
        />
      )}
    </div>
  );
}

export function LiteLLMUsersList({ canReset = false }: { canReset?: boolean }) {
  const modeName = useId();
  const [mode, setMode] = useState<Mode>("all");
  const [input, setInput] = useState("");
  const [page, setPage] = useState(1);
  const trimmed = input.trim();
  // The search starts at two characters (LiteLLM spec - searchUsers); a shorter
  // term shows the hint and sends nothing (Design System - T-LP6).
  const term = trimmed.length >= MIN_TERM ? trimmed : "";

  const sorted = useUsersSort();
  const sortKey = `${sorted?.sort ?? ""}|${sorted?.dir ?? ""}`;
  // A sort change returns to the first page (D-US1 pattern), adjusted during render.
  const [seenSort, setSeenSort] = useState(sortKey);
  if (seenSort !== sortKey) {
    setSeenSort(sortKey);
    setPage(1);
  }

  const caller = useCaller();
  const view: ViewProps = {
    ownOid: caller.oid,
    term,
    page,
    onPage: setPage,
  };

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
        <div className="flex min-w-48 flex-col gap-1">
          <SearchInput
            label="Search users"
            placeholder="Email or user id"
            maxLength={MAX_TERM}
            delayMs={DEBOUNCE_MS}
            value={input}
            onChange={(value) => {
              setInput(value);
              setPage(1);
            }}
          />
          {trimmed.length === 1 ? (
            <p className="text-muted-foreground text-sm">
              Type at least 2 characters
            </p>
          ) : null}
        </div>
      </div>
      {mode === "team" ? (
        <TeamMode
          {...view}
          canReset={canReset}
          onTeamChange={() => setPage(1)}
        />
      ) : term ? (
        <SearchView {...view} />
      ) : (
        <ListView {...view} team={null} />
      )}
    </div>
  );
}
