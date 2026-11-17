"use client";

import {
  ConnectionTestResultSchema,
  LiteLLMConnectionStatusSchema,
  OperationTogglesViewSchema,
  TeamLinkSchema,
} from "@llm-usage-lens/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import type { ReactNode } from "react";
import { z } from "zod";

import { UserSearch } from "@/components/litellm/UserSearch";
import { OperationGroup } from "@/components/settings/litellm-panel/OperationGroup";
import {
  OPERATION_FAMILIES,
  OPERATION_INFO,
  OTHER_FAMILY,
} from "@/components/settings/litellm-panel/operation-families";
import { TEAM_LINKS_KEY } from "@/components/settings/litellm-panel/keys";
import { TeamLinkForm } from "@/components/settings/litellm-panel/TeamLinkForm";
import { TeamLinkRow } from "@/components/settings/litellm-panel/TeamLinkRow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { LiteLLMPanelCapabilities } from "@/lib/auth/litellm-panel";
import { fetchApi, mutateApi } from "@/lib/query/fetch-api";

export type { LiteLLMPanelCapabilities };

// Source: docs/specs/2026-11-10-litellm.md — "Page and Settings" and "Security
// architecture" item 6: the Admin panel shows the connection URL, the edition
// (read-only) and whether the service key is configured, plus a connection
// test. There is no input for the key and its value is never fetched or shown.

// Unknown fields in a response are dropped, never rendered.
const StatusSchema = LiteLLMConnectionStatusSchema.strip();
const STATUS_KEY = ["litellm", "connection"] as const;
const TOGGLES_KEY = ["litellm", "toggles"] as const;
const TeamLinksSchema = z.object({ items: z.array(TeamLinkSchema) });

const CODE_GUARDRAILS = [
  "Operation allowlist and its method + route templates: only the listed operations can be called",
  "Hard-limit denylist: routes that can mint, reveal or widen access are never callable",
  "Path-parameter patterns and encoding: values are validated and encoded before use",
  "Exact request bodies per operation; unknown fields are rejected",
  "Edition gate: operations that need a paid edition are refused",
  "litellm-changed-by header is sent on every write",
  "Inference refusal: inference traffic is never proxied through the dashboard (pending verification)",
];

function PanelSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-5 w-64" />
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-4 w-48" />
    </div>
  );
}

function BaseUrlForm({
  stored,
  version,
}: {
  stored: string | null;
  version: number;
}) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(stored ?? "");
  const save = useMutation({
    mutationFn: () =>
      mutateApi(
        "/api/litellm/connection",
        "PUT",
        { baseUrl: value, version: version === 0 ? null : version },
        StatusSchema,
      ),
    onSuccess: (next) => queryClient.setQueryData(STATUS_KEY, next),
  });
  return (
    <form
      className="flex max-w-[72ch] flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <label htmlFor="litellm-base-url" className="text-sm font-medium">
        Base URL
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Input
          id="litellm-base-url"
          type="url"
          className="min-w-64 flex-1"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <Button type="submit" disabled={save.isPending}>
          Save
        </Button>
      </div>
      {save.isError ? (
        <p role="alert" className="text-destructive text-sm">
          {save.error.message}
        </p>
      ) : null}
    </form>
  );
}

function TogglesSection({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const query = useQuery({
    queryKey: TOGGLES_KEY,
    queryFn: () => fetchApi("/api/litellm/toggles", OperationTogglesViewSchema),
  });
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      mutateApi(
        "/api/litellm/toggles",
        "PUT",
        body,
        OperationTogglesViewSchema,
      ),
    onSuccess: (next) => {
      queryClient.setQueryData(TOGGLES_KEY, next);
      setConfirming(false);
    },
  });

  if (query.isError) {
    return (
      <p role="alert" className="text-destructive text-sm">
        {query.error.message}
      </p>
    );
  }
  if (query.data === undefined) {
    return (
      <div
        data-testid="litellm-toggles-loading"
        className="flex flex-col gap-2"
      >
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const data = query.data;
  const toggle = (op: string, enabled: boolean) =>
    save.mutate({
      version: data.version === 0 ? null : data.version,
      toggles: { [op]: enabled },
    });
  const groups = [...OPERATION_FAMILIES, OTHER_FAMILY].map((family) => ({
    ...family,
    ops: Object.entries(data.operations)
      .filter(
        ([op]) => (OPERATION_INFO[op]?.family ?? OTHER_FAMILY.id) === family.id,
      )
      .map(([name, v]) => ({ name, enabled: v.enabled, source: v.source })),
  }));
  return (
    <div className="flex max-w-[72ch] flex-col gap-4">
      {groups
        .filter((g) => g.ops.length > 0)
        .map((g) => (
          <OperationGroup
            key={g.id}
            id={g.id}
            label={g.label}
            description={g.description}
            ops={g.ops}
            canEdit={canEdit}
            pending={save.isPending}
            onToggle={toggle}
          />
        ))}
      {canEdit ? (
        confirming ? (
          <div
            role="group"
            aria-label="Confirm reset"
            className="flex flex-wrap items-center gap-3"
          >
            <span className="text-sm">
              Delete the saved values and use the defaults? Operations set in
              config.yaml keep their file value.
            </span>
            <Button
              type="button"
              variant="destructive"
              disabled={save.isPending}
              onClick={() =>
                save.mutate({ version: data.version, reset: true })
              }
            >
              Confirm reset
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <div>
            <Button
              type="button"
              variant="outline"
              disabled={data.version === 0}
              onClick={() => setConfirming(true)}
            >
              Reset to defaults
            </Button>
          </div>
        )
      ) : null}
      {save.isError ? (
        <p role="alert" className="text-destructive text-sm">
          {save.error.message}
        </p>
      ) : null}
    </div>
  );
}

function EnforcedInCode() {
  return (
    <section
      aria-labelledby="litellm-enforced-heading"
      className="max-w-[72ch]"
    >
      <h4 id="litellm-enforced-heading" className="text-sm font-medium">
        Enforced in code
      </h4>
      <ul className="text-muted-foreground list-disc pl-5 text-sm">
        {CODE_GUARDRAILS.map((g) => (
          <li key={g}>{g}</li>
        ))}
      </ul>
    </section>
  );
}

function ConnectionTab({ canEdit }: { canEdit: boolean }) {
  const status = useQuery({
    queryKey: STATUS_KEY,
    queryFn: () => fetchApi("/api/litellm/connection", StatusSchema),
  });
  const test = useMutation({
    mutationFn: () =>
      mutateApi(
        "/api/litellm/connection/test",
        "POST",
        {},
        ConnectionTestResultSchema,
      ),
  });

  if (status.isError) {
    return (
      <p role="alert" className="text-destructive text-sm">
        {status.error.message}
      </p>
    );
  }
  if (status.data === undefined) return <PanelSkeleton />;

  const s = status.data;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 text-sm">
        <div>
          <span className="text-muted-foreground">Base URL: </span>
          {s.baseUrl === null ? (
            <span>Not configured</span>
          ) : (
            <span className="font-mono">{s.baseUrl}</span>
          )}
        </div>
        <div>
          Edition: <span className="font-mono">{s.edition}</span>
        </div>
        <div>
          Service key configured:{" "}
          <span className="font-mono">
            {s.serviceKeyConfigured ? "yes" : "no"}
          </span>
        </div>
      </div>
      {canEdit ? (
        <>
          <BaseUrlForm
            key={`${s.version}:${s.baseUrl ?? ""}`}
            stored={s.baseUrl}
            version={s.version}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={test.isPending}
              onClick={() => test.mutate()}
            >
              Test connection
            </Button>
            {test.data ? (
              <p
                role="status"
                className={
                  test.data.result === "ok"
                    ? "text-sm"
                    : "text-destructive text-sm"
                }
              >
                {test.data.message}
              </p>
            ) : null}
            {test.isError ? (
              <p role="alert" className="text-destructive text-sm">
                {test.error.message}
              </p>
            ) : null}
          </div>
        </>
      ) : null}
      {test.data?.warnings?.length ? (
        <div
          data-testid="litellm-wildcard-warning"
          role="status"
          className="border-warning bg-warning/10 rounded-md border p-2 text-sm"
        >
          {test.data.warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TeamLinksTab({ canEdit }: { canEdit: boolean }) {
  const searchId = useId();
  const [term, setTerm] = useState("");
  const query = useQuery({
    queryKey: TEAM_LINKS_KEY,
    queryFn: () => fetchApi("/api/litellm/team-links", TeamLinksSchema),
  });

  if (query.isError) {
    return (
      <p role="alert" className="text-destructive text-sm">
        {query.error.message}
      </p>
    );
  }
  if (query.data === undefined) return <PanelSkeleton />;

  const needle = term.trim().toLowerCase();
  const items = query.data.items.filter(
    (link) =>
      link.teamId.toLowerCase().includes(needle) ||
      link.litellmTeamId.toLowerCase().includes(needle),
  );
  return (
    <div className="flex max-w-[72ch] flex-col gap-3">
      <label htmlFor={searchId} className="text-sm font-medium">
        Search teams
      </label>
      <Input
        id={searchId}
        type="search"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
      />
      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {query.data.items.length === 0
            ? "No team links yet"
            : "No matching teams"}
        </p>
      ) : (
        <ul className="divide-border divide-y">
          {items.map((link) => (
            <TeamLinkRow key={link.teamId} link={link} canEdit={canEdit} />
          ))}
        </ul>
      )}
      {canEdit ? <TeamLinkForm links={query.data.items} /> : null}
    </div>
  );
}

// Settings -> LiteLLM, tabbed like the page (LiteLLM spec -- Views by role).
// A tab mounts on first visit (its data loads then) and stays mounted, hidden,
// so a visited tab keeps its state when the user switches away.
const TABS = ["connection", "guardrails", "team-links", "users"] as const;
type TabId = (typeof TABS)[number];

export function LiteLLMPanel({
  capabilities,
}: {
  capabilities: LiteLLMPanelCapabilities;
}) {
  const [active, setActive] = useState<TabId>("connection");
  const [visited, setVisited] = useState<ReadonlySet<TabId>>(
    new Set<TabId>(["connection"]),
  );
  const content = (id: TabId, body: ReactNode) => (
    <TabsContent value={id} forceMount hidden={active !== id}>
      {visited.has(id) ? body : null}
    </TabsContent>
  );
  return (
    <Tabs
      value={active}
      onValueChange={(v) => {
        const id = TABS.find((t) => t === v);
        if (id === undefined) return;
        setActive(id);
        setVisited((prev) => new Set(prev).add(id));
      }}
    >
      <TabsList aria-label="LiteLLM settings">
        <TabsTrigger value="connection">Connection</TabsTrigger>
        <TabsTrigger value="guardrails">Guardrails</TabsTrigger>
        <TabsTrigger value="team-links">Team links</TabsTrigger>
        <TabsTrigger value="users">Users</TabsTrigger>
      </TabsList>
      {content(
        "connection",
        <ConnectionTab canEdit={capabilities.editConnection} />,
      )}
      {content(
        "guardrails",
        <>
          <TogglesSection canEdit={capabilities.editGuardrails} />
          <EnforcedInCode />
        </>,
      )}
      {content(
        "team-links",
        <TeamLinksTab canEdit={capabilities.editTeamLinks} />,
      )}
      {content("users", <UserSearch />)}
    </Tabs>
  );
}
