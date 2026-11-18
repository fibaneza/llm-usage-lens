"use client";

import { DirectoryPageSchema, type DirectoryRow } from "@llm-usage-lens/shared";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { Panel } from "@/components/display/Panel";
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
import { Button } from "@/components/ui/button";
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

const METHOD_LABELS: Record<DirectoryRow["authMethod"], string> = {
  entra: "Microsoft Entra",
  password: "Password",
  master: "Master user",
  local: "Local developer",
};

async function fetchDirectory(cursor: string | undefined, withMatch: boolean) {
  const query = (include: boolean) => {
    const params = new URLSearchParams();
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
}: {
  steps: AddUserSteps;
  ownOid: string;
  canCreate: boolean;
  litellmConfigured: boolean;
}) {
  const queryClient = useQueryClient();
  const units = useOrgUnits();
  const directory = useInfiniteQuery({
    queryKey: DIRECTORY_KEY,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchDirectory(pageParam, litellmConfigured),
    getNextPageParam: (page) => page.cursor,
  });
  if (directory.isPending) return <Skeleton className="h-48 w-full" />;
  if (directory.isError) throw directory.error;

  const teamNames = new Map(
    (units.data?.teams ?? []).map((team) => [team.id, team.name] as const),
  );
  const rows = directory.data.pages.flatMap((page) => page.items);
  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: DIRECTORY_KEY });

  if (rows.length === 0) {
    return <p className="text-muted-foreground text-sm">No people yet.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <Table>
        <TableCaption className="sr-only">People</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Sign-in</TableHead>
            <TableHead>Team</TableHead>
            <TableHead>LiteLLM</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const name = row.displayName ?? row.email ?? row.oid;
            const state = linkStateOf(row);
            return (
              <TableRow key={row.oid}>
                <TableCell className="font-medium">{name}</TableCell>
                <TableCell className="break-all">{row.email ?? "-"}</TableCell>
                <TableCell>{METHOD_LABELS[row.authMethod]}</TableCell>
                <TableCell>
                  {row.memberTeamId
                    ? (teamNames.get(row.memberTeamId) ?? row.memberTeamId)
                    : "-"}
                </TableCell>
                <TableCell>
                  {state && (litellmConfigured || state.state === "linked") ? (
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
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {directory.hasNextPage ? (
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
};

function PeoplePanel({
  canCreate,
  litellmConfigured,
  steps,
  ownOid,
  authMethod,
  stepUp,
}: PanelProps & { canCreate: boolean }) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const canAdd = steps.password || steps.team;
  return (
    <Panel
      title="People"
      boundaryTitle="the people list"
      description="People who have signed in or been added, with their team and LiteLLM link."
      actions={
        canAdd ? (
          <Button type="button" size="sm" onClick={() => setAdding(true)}>
            <Plus aria-hidden />
            Add user
          </Button>
        ) : null
      }
    >
      <People
        steps={steps}
        ownOid={ownOid}
        canCreate={canCreate}
        litellmConfigured={litellmConfigured}
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
  ...rest
}: Omit<PanelProps, "litellmConfigured"> & {
  // Absent: derived from the list route's enabledOperations (edition and toggle).
  canCreate?: boolean;
  litellmConfigured?: boolean;
}) {
  const props = { ...rest, litellmConfigured };
  return canCreate === undefined ? (
    <DerivedPeoplePanel {...props} />
  ) : (
    <PeoplePanel {...props} canCreate={litellmConfigured && canCreate} />
  );
}
