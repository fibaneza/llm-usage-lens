"use client";

import {
  DepartmentVisibilitySchema,
  TeamVisibilitySchema,
} from "@llm-usage-lens/shared";
import type {
  DepartmentVisibility,
  TeamVisibility,
} from "@llm-usage-lens/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { parseAsString, useQueryState } from "nuqs";
import { useState } from "react";

import { EmptyState } from "@/components/display/EmptyState";
import { accessErrorMessage } from "@/components/settings/access/access-error-message";
import {
  idPath,
  useOrgUnits,
} from "@/components/settings/access/access-queries";
import { accessCapabilities } from "@/components/settings/access/capabilities";
import {
  FormError,
  FormField,
  FormStatus,
  NativeSelect,
} from "@/components/settings/access/form-controls";
import type { AccessViewer } from "@/components/settings/access/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchApi, mutateApi } from "@/lib/query/fetch-api";
import { sectionData } from "@/lib/query/section-data";

// Source: docs/specs/2026-11-10-access-control.md - "Visibility and
// inheritance" (team level visible/hidden; user level all/own/none; the
// department cap; a team setting above the cap is stored, applied as the cap
// and shown as limited), "Permission matrix", "API routes (additions)" (version
// 0 = defaults not stored yet), "Enforcement" item 6 (stale version -> 409).
type UserLevel = "all" | "own" | "none";
const LEVEL_RANK: Record<UserLevel, number> = { none: 0, own: 1, all: 2 };
const LEVELS: { value: UserLevel; label: string }[] = [
  { value: "all", label: "All" },
  { value: "own", label: "Own" },
  { value: "none", label: "None" },
];
const TOTALS: { value: "visible" | "hidden"; label: string }[] = [
  { value: "visible", label: "Visible" },
  { value: "hidden", label: "Hidden" },
];

function Options({ items }: { items: { value: string; label: string }[] }) {
  return items.map((o) => (
    <option key={o.value} value={o.value}>
      {o.label}
    </option>
  ));
}

function TeamForm({
  data,
  limitedBy,
}: {
  data: TeamVisibility;
  limitedBy: UserLevel | undefined;
}) {
  const queryClient = useQueryClient();
  const [teamLevel, setTeamLevel] = useState(data.teamLevel);
  const [userLevel, setUserLevel] = useState(data.userLevel);
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () =>
      mutateApi(
        `/api/teams/${idPath(data.teamId)}/visibility`,
        "PUT",
        { teamLevel, userLevel, version: data.version },
        TeamVisibilitySchema,
      ),
    onSuccess: () => {
      setSaved(true);
      void queryClient.invalidateQueries({
        queryKey: ["access", "visibility"],
      });
    },
  });
  const limited =
    limitedBy !== undefined && LEVEL_RANK[userLevel] > LEVEL_RANK[limitedBy];

  return (
    <form
      className="flex max-w-[72ch] flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        save.mutate();
      }}
    >
      <FormField label="Team totals">
        {(props) => (
          <NativeSelect
            {...props}
            value={teamLevel}
            onChange={(e) => {
              setTeamLevel(e.target.value as typeof teamLevel);
              setSaved(false);
            }}
          >
            <Options items={TOTALS} />
          </NativeSelect>
        )}
      </FormField>
      <FormField label="User level">
        {(props) => (
          <NativeSelect
            {...props}
            value={userLevel}
            onChange={(e) => {
              setUserLevel(e.target.value as UserLevel);
              setSaved(false);
            }}
          >
            <Options items={LEVELS} />
          </NativeSelect>
        )}
      </FormField>
      {limited ? (
        <p className="text-muted-foreground text-sm">
          Limited by department: the department caps the user level at{" "}
          {limitedBy}.
        </p>
      ) : null}
      <div>
        <Button type="submit" size="sm" disabled={save.isPending}>
          Save visibility
        </Button>
      </div>
      {save.isError ? (
        <FormError>{accessErrorMessage(save.error)}</FormError>
      ) : null}
      {saved ? <FormStatus>Saved.</FormStatus> : null}
    </form>
  );
}

function DepartmentForm({ data }: { data: DepartmentVisibility }) {
  const queryClient = useQueryClient();
  const [departmentLevel, setDepartmentLevel] = useState(data.departmentLevel);
  const [maxUserLevel, setMaxUserLevel] = useState(data.maxUserLevel);
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () =>
      mutateApi(
        `/api/departments/${idPath(data.departmentId)}/visibility`,
        "PUT",
        { departmentLevel, maxUserLevel, version: data.version },
        DepartmentVisibilitySchema,
      ),
    onSuccess: () => {
      setSaved(true);
      void queryClient.invalidateQueries({
        queryKey: ["access", "visibility"],
      });
    },
  });

  return (
    <form
      className="flex max-w-[72ch] flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        save.mutate();
      }}
    >
      <FormField label="Department totals">
        {(props) => (
          <NativeSelect
            {...props}
            value={departmentLevel}
            onChange={(e) => {
              setDepartmentLevel(e.target.value as typeof departmentLevel);
              setSaved(false);
            }}
          >
            <Options items={TOTALS} />
          </NativeSelect>
        )}
      </FormField>
      <FormField
        label="User level cap"
        hint="No team in this department can show users above this level."
      >
        {(props) => (
          <NativeSelect
            {...props}
            value={maxUserLevel}
            onChange={(e) => {
              setMaxUserLevel(e.target.value as UserLevel);
              setSaved(false);
            }}
          >
            <Options items={LEVELS} />
          </NativeSelect>
        )}
      </FormField>
      <div>
        <Button type="submit" size="sm" disabled={save.isPending}>
          Save visibility
        </Button>
      </div>
      {save.isError ? (
        <FormError>{accessErrorMessage(save.error)}</FormError>
      ) : null}
      {saved ? <FormStatus>Saved.</FormStatus> : null}
    </form>
  );
}

function TeamVisibilityPanel({
  teamId,
  departmentId,
}: {
  teamId: string;
  departmentId: string;
}) {
  const query = useQuery({
    queryKey: ["access", "visibility", "team", teamId],
    queryFn: () =>
      fetchApi(`/api/teams/${idPath(teamId)}/visibility`, TeamVisibilitySchema),
  });
  // The cap is context only: a caller outside the department gets a 404 and the
  // team form still renders without the note.
  const cap = useQuery({
    queryKey: ["access", "visibility", "department", departmentId],
    queryFn: () =>
      fetchApi(
        `/api/departments/${idPath(departmentId)}/visibility`,
        DepartmentVisibilitySchema,
      ),
    retry: false,
  });
  const data = sectionData(query);
  if (data === undefined) return <Skeleton className="h-40 w-full" />;
  return (
    <TeamForm key={teamId} data={data} limitedBy={cap.data?.maxUserLevel} />
  );
}

function DepartmentVisibilityPanel({ departmentId }: { departmentId: string }) {
  const query = useQuery({
    queryKey: ["access", "visibility", "department", departmentId],
    queryFn: () =>
      fetchApi(
        `/api/departments/${idPath(departmentId)}/visibility`,
        DepartmentVisibilitySchema,
      ),
  });
  const data = sectionData(query);
  if (data === undefined) return <Skeleton className="h-40 w-full" />;
  return <DepartmentForm key={departmentId} data={data} />;
}

export function VisibilitySection({ viewer }: { viewer: AccessViewer }) {
  const capabilities = accessCapabilities(viewer);
  const orgUnits = sectionData(useOrgUnits());
  // Follows the Team page's picker (?team=) until the user picks a scope here.
  const [pageTeam] = useQueryState("team", parseAsString);
  const [chosen, setChosen] = useState<string | null>(null);
  const [seenPageTeam, setSeenPageTeam] = useState(pageTeam);
  if (seenPageTeam !== pageTeam) {
    setSeenPageTeam(pageTeam);
    setChosen(null);
  }

  if (orgUnits === undefined) {
    return <Skeleton className="h-48 w-full" />;
  }
  const options = [
    ...orgUnits.teams.map((t) => ({
      key: `team:${t.id}`,
      label: `Team: ${t.name}`,
      team: t,
    })),
    ...(capabilities.editDepartmentVisibility
      ? orgUnits.departments.map((d) => ({
          key: `department:${d.id}`,
          label: `Department: ${d.name}`,
          department: d,
        }))
      : []),
  ];
  const scope =
    options.find((o) => o.key === chosen) ??
    options.find((o) => o.key === `team:${pageTeam}`) ??
    options[0];
  if (scope === undefined) return <EmptyState title="No teams to manage." />;

  return (
    <div className="flex flex-col gap-4">
      <div className="max-w-[72ch]">
        <FormField label="Scope">
          {(props) => (
            <NativeSelect
              {...props}
              value={scope.key}
              onChange={(e) => setChosen(e.target.value)}
            >
              {options.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
      </div>
      {"team" in scope ? (
        <TeamVisibilityPanel
          teamId={scope.team.id}
          departmentId={scope.team.departmentId}
        />
      ) : (
        <DepartmentVisibilityPanel departmentId={scope.department.id} />
      )}
    </div>
  );
}
