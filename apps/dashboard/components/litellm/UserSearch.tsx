"use client";

import { CircleDollarSign, Wallet } from "lucide-react";
import { useEffect, useId, useState } from "react";
import type { ReactNode } from "react";

import {
  LiteLLMUserDetailResponseSchema,
  LiteLLMUserSearchResponseSchema,
} from "@llm-usage-lens/shared";

import { formatUsd } from "@/components/charts/chart-data";
import { MetricCard } from "@/components/display/MetricCard";
import { useIsMobile } from "@/hooks/use-mobile";
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
import { ApiRequestError } from "@/lib/query/fetch-api";

import { CombinedPersonCard } from "./combined/CombinedPersonCard";
import { DailySpend } from "./DailySpend";
import { LiteLLMReportedBadge } from "./LiteLLMReportedBadge";
import { Empty, Unavailable } from "./LiteLLMSection";
import { useLiteLLMQueryState, useUrlRange } from "./use-litellm-query";

// searchUsers takes 2-100 characters (LiteLLM spec -- Gateway allowlist).
const MIN_TERM = 2;
const MAX_TERM = 100;
const DEBOUNCE_MS = 500;
// Per-user cost is absent until per-user reporting is approved (LD23).
const HIDDEN = "Hidden until per-user reporting is approved";

export const budget = (value: number | null | undefined) =>
  value === undefined ? HIDDEN : value === null ? "No limit" : formatUsd(value);
// undefined: hidden by the cap (LD23). null: LiteLLM reported no spend, shown
// as a dash and never as $0 (Design System, LF1 D-LF1).
export const spend = (value: number | null | undefined) =>
  value === undefined ? HIDDEN : value === null ? "\u2014" : formatUsd(value);

function QueryFailure({ error }: { error: unknown }) {
  return (
    <p role="alert" className="text-destructive text-sm">
      {error instanceof Error ? error.message : "Could not load users."}
    </p>
  );
}

// `account` is the linked app account and its state for the selected row, shown
// by the LiteLLM users tab; the detail route itself carries no link data.
export function UserDetail({
  userId,
  account,
}: {
  userId: string;
  account?: ReactNode;
}) {
  const { keyParts, query: range } = useUrlRange();
  const query = useLiteLLMQueryState(
    ["user", userId, ...keyParts],
    `/api/litellm/users/${encodeURIComponent(userId)}?${range}`,
    LiteLLMUserDetailResponseSchema,
  );
  const headingId = useId();

  let body;
  if (query.isPending) {
    body = <Skeleton className="h-32 w-full" />;
  } else if (query.isError) {
    // Missing and out-of-scope users answer the same 404 (LT21).
    body =
      query.error instanceof ApiRequestError && query.error.status === 404 ? (
        <Empty>User not found</Empty>
      ) : (
        <QueryFailure error={query.error} />
      );
  } else if (query.data.status !== "ok") {
    body = <Unavailable />;
  } else {
    const user = query.data.data;
    body = (
      <div className="flex flex-col gap-4">
        <p className="text-muted-foreground text-sm">{user.email}</p>
        {account ?? null}
        <div className="grid gap-4 sm:grid-cols-2">
          <MetricCard
            title="Spend"
            value={spend(user.spend)}
            icon={CircleDollarSign}
          />
          <MetricCard
            title="Budget"
            value={budget(user.maxBudget)}
            icon={Wallet}
          />
        </div>
        {user.combined ? (
          <CombinedPersonCard
            title="Combined usage"
            response={user.combined}
            headingLevel={3}
          />
        ) : null}
        {user.daily ? <DailySpend daily={user.daily} /> : null}
      </div>
    );
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={headingId} className="text-base font-semibold">
          User usage
        </h3>
        <LiteLLMReportedBadge />
      </div>
      {body}
    </section>
  );
}

function Results({
  term,
  selected,
  onSelect,
}: {
  term: string;
  selected: string | null;
  onSelect: (userId: string) => void;
}) {
  const isMobile = useIsMobile();
  const query = useLiteLLMQueryState(
    ["users", term],
    `/api/litellm/users?q=${encodeURIComponent(term)}`,
    LiteLLMUserSearchResponseSchema,
  );
  if (query.isPending) return <Skeleton className="h-24 w-full" />;
  if (query.isError) return <QueryFailure error={query.error} />;
  if (query.data.status !== "ok") return <Unavailable />;
  const { users } = query.data.data;
  if (users.length === 0) return <Empty>No users found</Empty>;
  return (
    <div className="flex flex-col gap-3">
      <LiteLLMReportedBadge />
      {isMobile ? (
        <ul role="list" aria-label="User results" className="space-y-3">
          {users.map((user) => (
            <li
              key={user.userId}
              data-state={user.userId === selected ? "selected" : undefined}
              className="bg-card text-card-foreground rounded-card data-[state=selected]:border-ring space-y-3 border p-4"
            >
              <button
                type="button"
                className="focus-visible:ring-ring min-h-touch w-full rounded-sm text-left font-medium break-words underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:outline-none"
                onClick={() => onSelect(user.userId)}
              >
                {user.email}
              </button>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div className="col-span-2 min-w-0">
                  <dt className="text-muted-foreground text-xs">Teams</dt>
                  <dd className="break-words">
                    {user.teams.map((team) => team.teamName).join(", ")}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-muted-foreground text-xs">Spend</dt>
                  <dd className="font-mono break-words tabular-nums">
                    {spend(user.spend)}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-muted-foreground text-xs">Budget</dt>
                  <dd className="font-mono break-words tabular-nums">
                    {budget(user.maxBudget)}
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      ) : (
        <div>
          <Table>
            <TableCaption className="sr-only">User results</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Teams</TableHead>
                <TableHead className="text-right">Spend</TableHead>
                <TableHead className="text-right">Budget</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow
                  key={user.userId}
                  data-state={user.userId === selected ? "selected" : undefined}
                >
                  <TableCell>
                    <button
                      type="button"
                      className="focus-visible:ring-ring rounded-sm font-medium underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:outline-none"
                      onClick={() => onSelect(user.userId)}
                    >
                      {user.email}
                    </button>
                  </TableCell>
                  <TableCell>
                    {user.teams.map((team) => team.teamName).join(", ")}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {spend(user.spend)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {budget(user.maxBudget)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// User search shared by the page's Users tab and Settings -> LiteLLM -> Users
// (LiteLLM spec -- Views by role). Scoping is the route's job; this renders.
export function UserSearch() {
  const inputId = useId();
  const [input, setInput] = useState("");
  const [term, setTerm] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setTerm(input.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input]);

  const active = term.length >= MIN_TERM && input.trim().length >= MIN_TERM;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex max-w-[72ch] flex-col gap-2">
        <label htmlFor={inputId} className="text-sm font-medium">
          Search users
        </label>
        <Input
          id={inputId}
          type="search"
          maxLength={MAX_TERM}
          placeholder="Email or user id"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
      </div>
      {active ? (
        <Results term={term} selected={selected} onSelect={setSelected} />
      ) : null}
      {selected !== null ? <UserDetail userId={selected} /> : null}
    </div>
  );
}
