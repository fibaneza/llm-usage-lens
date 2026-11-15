"use client";

import { CircleDollarSign, Wallet } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { formatUsd } from "@/components/charts/chart-data";
import { MetricCard } from "@/components/display/MetricCard";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiRequestError } from "@/lib/query/fetch-api";
import {
  LiteLLMUserDetailResponseSchema,
  LiteLLMUserSearchResponseSchema,
} from "@llm-usage-lens/shared";

import { DailySpend } from "./DailySpend";
import { LiteLLMReportedBadge } from "./LiteLLMReportedBadge";
import { Empty, Unavailable } from "./LiteLLMSection";
import { useLiteLLMQueryState } from "./use-litellm-query";

// searchUsers takes 2-100 characters (LiteLLM spec -- Gateway allowlist).
const MIN_TERM = 2;
const MAX_TERM = 100;
const DEBOUNCE_MS = 500;

const budget = (value: number | null) =>
  value === null ? "No limit" : formatUsd(value);

function QueryFailure({ error }: { error: unknown }) {
  return (
    <p role="alert" className="text-destructive text-sm">
      {error instanceof Error ? error.message : "Could not load users."}
    </p>
  );
}

function UserDetail({ userId }: { userId: string }) {
  const query = useLiteLLMQueryState(
    ["user", userId],
    `/api/litellm/users/${encodeURIComponent(userId)}`,
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
  } else if (query.data.status === "unavailable") {
    body = <Unavailable />;
  } else {
    const user = query.data.data;
    body = (
      <div className="flex flex-col gap-4">
        <p className="text-muted-foreground text-sm">{user.email}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <MetricCard
            title="Spend"
            value={formatUsd(user.spend)}
            icon={CircleDollarSign}
          />
          <MetricCard
            title="Budget"
            value={budget(user.maxBudget)}
            icon={Wallet}
          />
        </div>
        <DailySpend daily={user.daily} />
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
  const query = useLiteLLMQueryState(
    ["users", term],
    `/api/litellm/users?q=${encodeURIComponent(term)}`,
    LiteLLMUserSearchResponseSchema,
  );
  if (query.isPending) return <Skeleton className="h-24 w-full" />;
  if (query.isError) return <QueryFailure error={query.error} />;
  if (query.data.status === "unavailable") return <Unavailable />;
  const { users } = query.data.data;
  if (users.length === 0) return <Empty>No users found</Empty>;
  return (
    <div className="flex flex-col gap-3">
      <LiteLLMReportedBadge />
      <Table>
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
                {formatUsd(user.spend)}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {budget(user.maxBudget)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
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
