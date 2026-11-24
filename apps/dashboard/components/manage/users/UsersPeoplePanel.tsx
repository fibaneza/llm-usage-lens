"use client";

import {
  DirectoryPageSchema,
  DIRECTORY_SORTS,
  DirectorySortSchema,
  type DirectoryRow,
} from "@llm-usage-lens/shared";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { useQueryStates } from "nuqs";
import { useEffect, useState } from "react";
import { z } from "zod";

import { Panel } from "@/components/display/Panel";
import { ResetMemberSpendDialog } from "@/components/litellm/ResetMemberSpendDialog";
import { LiteLLMLinkCell } from "@/components/manage/users/LiteLLMLinkCell";
import type { LinkState } from "@/components/manage/users/LiteLLMLinkCell";
import { AddUserDialog } from "@/components/manage/users/AddUserDialog";
import { useLiteLLMQueryState } from "@/components/litellm/use-litellm-query";
import { useOrgUnits } from "@/components/settings/access/access-queries";
import type {
  AccessViewer,
  StepUpActions,
} from "@/components/settings/access/types";
import { Badge } from "@/components/ui/badge";
import {
  SORT_PARAMS,
  SortableHeader,
  readSort,
} from "@/components/tables/SortableHeader";
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
import type { AddUserSteps } from "@/lib/auth/add-user-steps";
import { ApiRequestError, fetchApi } from "@/lib/query/fetch-api";

// Source: Design System - Management improvements, Users (D15) and User link
// states (D16); Access Control - API routes (GET /api/identities/directory,
// 25 a page, cursor). The caller's flags come from the server; the routes
// decide every write again.
const EnabledOperationsSchema = z.object({
  enabledOperations: z.array(z.string()),
});

// Create and link follows the LiteLLM edition and the createUser toggle: the
// list route reports the caller's enabledOperations (LiteLLM spec - createUser).
function useCanCreate(): boolean {
  const query = useLiteLLMQueryState(
    ["users-list", "capabilities"],
    "/api/litellm/users?page=1&pageSize=1",
    EnabledOperationsSchema,
  );
  return (
    query.data?.status === "ok" &&
    query.data.data.enabledOperations.includes("createUser")
  );
}

const DIRECTORY_KEY = ["manage", "users", "directory"] as const;
const MIN_TERM = 2;
const DEBOUNCE_MS = 500;
const EMPTY = "—";

// UTC calendar day of an ISO timestamp (Rule 20.1).
const day = (iso: string | null | undefined) =>
  iso ? iso.slice(0, 10) : EMPTY;

const METHOD_LABELS: Record<DirectoryRow["authMethod"], string> = {
  entra: "Microsoft Entra",
  password: "Password",
  master: "Master user",
  local: "Local developer",
};

type DirectoryRequest = {
  cursor: string | undefined;
  sort: string;
  dir: string;
  q: string | undefined;
};

async function fetchDirectory(
  { cursor, sort, dir, q }: DirectoryRequest,
  withMatch: boolean,
) {
  const query = (include: boolean) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    else {
      params.set("sort", sort);
      params.set("dir", dir);
    }
    if (include) params.set("include", "litellmMatch");
    if (cursor) params.set("cursor", cursor);
    const text = params.toString();
    return `/api/identities/directory${text ? `?${text}` : ""}`;
  };
  try {
    return await fetchApi(query(withMatch), DirectoryPageSchema);
  } catch (error) {
    // A LiteLLM outage hides only the match suggestions, not the people.
    if (
      withMatch &&
      error instanceof ApiRequestError &&
      error.code === "LITELLM_UNAVAILABLE"
    ) {
      return fetchApi(query(false), DirectoryPageSchema);
    }
    throw error;
  }
}

function linkStateOf(row: DirectoryRow): LinkState | null {
  if (row.litellm.state === "linked") {
    return { state: "linked", litellmUserId: row.litellm.litellmUserId };
  }
  if (row.match) {
    return {
      state: "match",
      litellmUserId: row.match.litellmUserId,
      email: row.match.email,
    };
  }
  return row.match === null ? { state: "none" } : null;
}

function People({
  steps,
  ownOid,
  canCreate,
  litellmConfigured,
  canResetSpend,
  term,
}: {
  steps: AddUserSteps;
  ownOid: string;
  canCreate: boolean;
  litellmConfigured: boolean;
  canResetSpend: boolean;
  term: string | undefined;
}) {
  const [params] = useQueryStates(SORT_PARAMS);
  const parsedSort = DirectorySortSchema.safeParse(params.sort ?? "name");
  const { key, dir } = readSort(
    parsedSort.success ? parsedSort.data : "name",
    params.dir,
    "name",
    DIRECTORY_SORTS,
  );
  const queryClient = useQueryClient();
  const units = useOrgUnits();
  const directory = useInfiniteQuery({
    queryKey: [...DIRECTORY_KEY, key, dir, term ?? null],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      fetchDirectory(
        { cursor: pageParam, sort: key, dir, q: term },
        litellmConfigured,
      ),
    getNextPageParam: (page) => page.cursor,
    // A sort change keeps the table (and the focused header button) mounted
    // while page 1 of the new order loads; a new search term does not.
    placeholderData: (previous, previousQuery) =>
      previousQuery && previousQuery.queryKey[5] === (term ?? null)
        ? previous
        : undefined,
  });
  if (directory.isPending) return <Skeleton className="h-48 w-full" />;
  if (directory.isError) throw directory.error;

  const teamNames = new Map(
    (units.data?.teams ?? []).map((team) => [team.id, team.name] as const),
  );
  const rows = directory.data.pages.flatMap((page) => page.items);
  const truncated = directory.data.pages.some((page) => page.truncated);
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: DIRECTORY_KEY });

  if (rows.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        {term ? "No people match." : "No people yet."}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <Table>
        <TableCaption className="sr-only">People</TableCaption>
        <TableHeader>
          <TableRow>
            <SortableHeader
              sortKey="name"
              sortKeys={DIRECTORY_SORTS}
              defaultKey="name"
            >
              Name
            </SortableHeader>
            <SortableHeader
              sortKey="email"
              sortKeys={DIRECTORY_SORTS}
              defaultKey="name"
            >
              Email
            </SortableHeader>
            <TableHead>Sign-in</TableHead>
            <SortableHeader
              sortKey="createdAt"
              sortKeys={DIRECTORY_SORTS}
              defaultKey="name"
            >
              Created
            </SortableHeader>
            <SortableHeader
              sortKey="lastSignInAt"
              sortKeys={DIRECTORY_SORTS}
              defaultKey="name"
            >
              Last sign-in
            </SortableHeader>
            <SortableHeader
              sortKey="team"
              sortKeys={DIRECTORY_SORTS}
              defaultKey="name"
            >
              Team
            </SortableHeader>
            <TableHead>LiteLLM</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const name = row.displayName ?? row.email ?? row.oid;
            const state = linkStateOf(row);
            return (
              <TableRow key={row.oid}>
                <TableCell className="font-medium">
                  <Link
                    href={`/dashboard/manage/users/${encodeURIComponent(row.oid)}`}
                    className="underline-offset-2 hover:underline"
                  >
                    {name}
                  </Link>
                </TableCell>
                <TableCell className="break-all">
                  {row.email ?? EMPTY}
                </TableCell>
                <TableCell>{METHOD_LABELS[row.authMethod]}</TableCell>
                <TableCell>{day(row.createdAt)}</TableCell>
                <TableCell>{day(row.lastSignInAt)}</TableCell>
                <TableCell>
                  {row.memberTeamId
                    ? (teamNames.get(row.memberTeamId) ?? row.memberTeamId)
                    : EMPTY}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-2">
                    {state &&
                    (litellmConfigured || state.state === "linked") ? (
                      <LiteLLMLinkCell
                        subject={{
                          oid: row.oid,
                          name,
                          email: row.email,
                          version: row.linkVersion,
                        }}
                        link={state}
                        canWrite={steps.link && row.oid !== ownOid}
                        canCreate={canCreate}
                        onChanged={refresh}
                      />
                    ) : (
                      <Badge variant="outline">
                        {litellmConfigured
                          ? "Not linked"
                          : "LiteLLM not configured"}
                      </Badge>
                    )}
                    {canResetSpend &&
                    litellmConfigured &&
                    row.litellm.state === "linked" ? (
                      <ResetMemberSpendDialog
                        oid={row.oid}
                        litellmUserId={row.litellm.litellmUserId}
                        name={name}
                      />
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {truncated ? (
        <p className="text-muted-foreground text-sm">
          The list is truncated at 2,000 people; search to find anyone else.
        </p>
      ) : null}
      {directory.hasNextPage && !term ? (
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={directory.isFetchingNextPage}
            onClick={() => void directory.fetchNextPage()}
          >
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}

type PanelProps = {
  steps: AddUserSteps;
  ownOid: string;
  authMethod: AccessViewer["authMethod"];
  stepUp: StepUpActions;
  litellmConfigured: boolean;
  canResetSpend: boolean;
};

function PeoplePanel({
  canCreate,
  litellmConfigured,
  canResetSpend,
  steps,
  ownOid,
  authMethod,
  stepUp,
}: PanelProps & { canCreate: boolean }) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [term, setTerm] = useState<string | undefined>(undefined);
  useEffect(() => {
    const trimmed = text.trim();
    const next = trimmed.length >= MIN_TERM ? trimmed : undefined;
    const timer = setTimeout(() => setTerm(next), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);
  const canAdd = steps.password || steps.team;
  return (
    <Panel
      title="People"
      boundaryTitle="the people list"
      description="People who have signed in or been added, with their team and LiteLLM link."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-40 min-w-0 sm:w-56">
            <Search
              aria-hidden
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2"
            />
            <Input
              type="search"
              aria-label="Search people"
              placeholder="Search people"
              maxLength={100}
              value={text}
              onChange={(event) => setText(event.target.value)}
              className="pl-8"
            />
          </div>
          {canAdd ? (
            <Button type="button" size="sm" onClick={() => setAdding(true)}>
              <Plus aria-hidden />
              Add user
            </Button>
          ) : null}
        </div>
      }
    >
      <People
        steps={steps}
        ownOid={ownOid}
        canCreate={canCreate}
        litellmConfigured={litellmConfigured}
        canResetSpend={canResetSpend}
        term={term}
      />
      {adding ? (
        <AddUserDialog
          steps={steps}
          authMethod={authMethod}
          stepUp={stepUp}
          onClose={() => setAdding(false)}
          onWritten={() =>
            void queryClient.invalidateQueries({ queryKey: DIRECTORY_KEY })
          }
        />
      ) : null}
    </Panel>
  );
}

function DerivedPeoplePanel(props: PanelProps) {
  return <PeoplePanel {...props} canCreate={useCanCreate()} />;
}

// The page resolves canCreate and litellmConfigured on the server (LiteLLM
// spec LD37: not configured is a handled state), so no extra request is made.
export function UsersPeoplePanel({
  canCreate,
  litellmConfigured = true,
  canResetSpend = false,
  ...rest
}: Omit<PanelProps, "litellmConfigured" | "canResetSpend"> & {
  // Absent: derived from the list route's enabledOperations (edition and toggle).
  canCreate?: boolean;
  litellmConfigured?: boolean;
  // RS1: resolved by the page (configured, toggle on, caller may write).
  canResetSpend?: boolean;
}) {
  const props = { ...rest, litellmConfigured, canResetSpend };
  return canCreate === undefined ? (
    <DerivedPeoplePanel {...props} />
  ) : (
    <PeoplePanel {...props} canCreate={litellmConfigured && canCreate} />
  );
}
