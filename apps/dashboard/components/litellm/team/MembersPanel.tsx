"use client";

import {
  LiteLLMMembersResponseSchema,
  LiteLLMUserDetailResponseSchema,
} from "@llm-usage-lens/shared";
import { useState } from "react";
import { z } from "zod";

import { formatUsd } from "@/components/charts/chart-data";
import { BudgetBar, budgetPercent } from "@/components/manage/BudgetBar";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { ApiRequestError, mutateApi } from "@/lib/query/fetch-api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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

import { NativeSelect } from "./native-select";
import type { TeamPanelProps } from "./panel-props";
import { Empty, NotConnected, Unavailable } from "../LiteLLMSection";
import {
  ActionButton,
  ConfirmAction,
  FormDialog,
  WriteError,
} from "./write-parts";
import { DailySpend } from "../DailySpend";
import {
  useLiteLLMQuery,
  useLiteLLMQueryState,
  useUrlRange,
} from "../use-litellm-query";
import { useTeamDetail } from "../use-team-detail";
import { memberPath, teamPath, useTeamWrite } from "./use-team-write";

const NEAR_BUDGET_PERCENT = 80;
const HIDDEN = "Hidden until per-user reporting is approved";

const parsed = (value: string) =>
  value.trim() === "" ? undefined : Number(value);

type Candidate = { oid: string; name: string; email: string };

function AddMember({
  teamId,
  candidates,
}: {
  teamId: string;
  candidates: readonly Candidate[];
}) {
  const { write, pending, error, clearError } = useTeamWrite(teamId);
  const [oid, setOid] = useState("");
  return (
    <FormDialog
      label="Add member"
      text="Add member"
      title="Add member"
      description="Add an existing dashboard member to this team."
      submitLabel="Add"
      canSubmit={oid !== ""}
      hideSubmit={candidates.length === 0}
      pending={pending}
      error={error}
      onOpen={clearError}
      onSubmit={async () => {
        const result = await write(
          teamPath(teamId, "/members"),
          "POST",
          { oid },
          ["members"],
        );
        if (result.ok) setOid("");
        return result.ok;
      }}
    >
      {candidates.length === 0 ? (
        <p className="text-sm">Everyone in this team is already in LiteLLM</p>
      ) : (
        <label className="grid gap-1 text-sm font-medium">
          Member
          <NativeSelect value={oid} onChange={(e) => setOid(e.target.value)}>
            <option value="">Select a member</option>
            {candidates.map((c) => (
              <option key={c.oid} value={c.oid}>
                {c.name} ({c.email})
              </option>
            ))}
          </NativeSelect>
        </label>
      )}
    </FormDialog>
  );
}

function EditMemberLimits({
  teamId,
  oid,
  name,
  budgetEnabled,
  limitsEnabled,
}: {
  teamId: string;
  oid: string;
  name: string;
  budgetEnabled: boolean;
  limitsEnabled: boolean;
}) {
  const { write, pending, error, clearError } = useTeamWrite(teamId);
  const [budget, setBudget] = useState("");
  const [rpm, setRpm] = useState("");
  const [tpm, setTpm] = useState("");
  return (
    <FormDialog
      label={`Edit limits for ${name}`}
      text="Edit limits"
      title={`Edit limits for ${name}`}
      submitLabel="Save"
      canSubmit={[budget, rpm, tpm].some((v) => v.trim() !== "")}
      pending={pending}
      error={error}
      onOpen={clearError}
      onSubmit={async () => {
        const maxBudgetInTeam = parsed(budget);
        if (budgetEnabled && maxBudgetInTeam !== undefined) {
          const result = await write(
            memberPath(teamId, oid, "/budget"),
            "PATCH",
            { maxBudgetInTeam },
            ["members"],
          );
          if (!result.ok) return false;
        }
        const rpmLimit = parsed(rpm);
        const tpmLimit = parsed(tpm);
        if (
          limitsEnabled &&
          (rpmLimit !== undefined || tpmLimit !== undefined)
        ) {
          const result = await write(
            memberPath(teamId, oid, "/limits"),
            "PATCH",
            {
              ...(rpmLimit === undefined ? {} : { rpmLimit }),
              ...(tpmLimit === undefined ? {} : { tpmLimit }),
            },
            ["members"],
          );
          if (!result.ok) return false;
        }
        setBudget("");
        setRpm("");
        setTpm("");
        return true;
      }}
    >
      {budgetEnabled ? (
        <label className="grid gap-1 text-sm font-medium">
          Member budget (USD)
          <Input
            type="number"
            min={0}
            step="any"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
          />
        </label>
      ) : null}
      {limitsEnabled ? (
        <>
          <label className="grid gap-1 text-sm font-medium">
            Member requests per minute
            <Input
              type="number"
              min={1}
              step={1}
              value={rpm}
              onChange={(e) => setRpm(e.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Member tokens per minute
            <Input
              type="number"
              min={1}
              step={1}
              value={tpm}
              onChange={(e) => setTpm(e.target.value)}
            />
          </label>
        </>
      ) : null}
    </FormDialog>
  );
}

type Member = {
  userId: string;
  email: string;
  oid?: string | undefined;
  spend?: number | undefined;
};

// G1: the member's daily spend for the URL range, read through the existing
// user route only once the dialog is open (Design System - Management pages,
// Team page views and links).
function DailySpendBody({ userId }: { userId: string }) {
  const { keyParts, query } = useUrlRange();
  const result = useLiteLLMQueryState(
    ["user", userId, ...keyParts],
    `/api/litellm/users/${encodeURIComponent(userId)}?${query}`,
    LiteLLMUserDetailResponseSchema,
  );
  if (result.isPending) return <Skeleton className="h-24 w-full" />;
  if (result.isError) {
    return (
      <p role="alert" className="text-destructive text-sm">
        {result.error instanceof Error
          ? result.error.message
          : "Could not load daily spend."}
      </p>
    );
  }
  if (result.data.status === "unavailable") return <Unavailable />;
  return <DailySpend daily={result.data.data.daily ?? []} />;
}

function MemberDailySpend({ userId, name }: { userId: string; name: string }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={`Daily spend for ${name}`}
        >
          Daily spend
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`Daily spend for ${name}`}</DialogTitle>
          <DialogDescription>
            LiteLLM-reported spend per UTC day for the selected range.
          </DialogDescription>
        </DialogHeader>
        <DailySpendBody userId={userId} />
      </DialogContent>
    </Dialog>
  );
}

const NOT_IN_DASHBOARD =
  "Not a member of this team in the dashboard — add them to reset or manage.";

// RS1 (D6): add the LiteLLM member to the app team through the app-team add
// route, as the Users page does; offered only to callers who may write members
// (the members response carries `candidates` for them alone).
function AddToTeam({
  teamId,
  email,
  teamName,
  onAdded,
}: {
  teamId: string;
  email: string;
  teamName: string;
  onAdded: () => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function add() {
    setPending(true);
    setError(null);
    try {
      await mutateApi(
        `/api/teams/${encodeURIComponent(teamId)}/members`,
        "POST",
        { emailOrUpn: email },
        z.unknown(),
      );
      await onAdded();
    } catch (caught) {
      if (!(caught instanceof ApiRequestError)) throw caught;
      setError(caught.message);
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <ConfirmAction
        label={`Add ${email} to team`}
        text="Add to team"
        title="Add to team?"
        description={`Adds ${email} to ${teamName} in the dashboard. LiteLLM reported this email and it is not verified. Recorded in the audit log.`}
        disabled={pending}
        onConfirm={() => void add()}
      />
      <WriteError message={error} />
    </>
  );
}

const ROW_OPERATIONS = [
  "removeTeamMember",
  "resetMemberSpend",
  "resetMemberBudget",
  "disableMember",
  "enableMember",
  "setMemberBudget",
  "setMemberLimits",
] as const;

// One action block for a member row, shared by the table and the card layouts.
function MemberActions({
  teamId,
  member,
  name,
  teamName,
  ops,
  pending,
  write,
  canAddToTeam,
  onAdded,
}: {
  teamId: string;
  member: Member;
  name: string;
  teamName: string;
  ops: ReadonlySet<string>;
  pending: boolean;
  write: ReturnType<typeof useTeamWrite>["write"];
  canAddToTeam: boolean;
  onAdded: () => Promise<void>;
}) {
  const oid = member.oid;
  const act = (action: string, method: "POST" | "DELETE" = "POST") =>
    oid
      ? write(memberPath(teamId, oid, action), method, undefined, ["members"])
      : Promise.resolve();
  // An undefined spend is the Organisation-cap signal: no per-user reporting.
  const dailySpend = ops.has("getUserDailySpend") && member.spend !== undefined;
  const rowActions = oid ? ROW_OPERATIONS.some((op) => ops.has(op)) : false;
  if (!oid) {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-xs">
          {NOT_IN_DASHBOARD}
        </span>
        {canAddToTeam ? (
          <AddToTeam
            teamId={teamId}
            email={member.email}
            teamName={teamName}
            onAdded={onAdded}
          />
        ) : null}
        {dailySpend ? (
          <MemberDailySpend userId={member.userId} name={name} />
        ) : null}
      </span>
    );
  }
  if (!dailySpend && !rowActions) return null;
  return (
    <span className="flex flex-wrap gap-2">
      {dailySpend ? (
        <MemberDailySpend userId={member.userId} name={name} />
      ) : null}
      {oid ? (
        <>
          {ops.has("removeTeamMember") ? (
            <ConfirmAction
              label={`Remove ${name}`}
              text="Remove"
              title={`Remove ${name}?`}
              description={`Removes ${name} from ${teamName}. Recorded in the audit log.`}
              disabled={pending}
              onConfirm={() => void act("", "DELETE")}
            />
          ) : null}
          {ops.has("resetMemberSpend") ? (
            <ConfirmAction
              label={`Reset spend for ${name}`}
              text="Reset spend"
              title={`Reset spend for ${name}?`}
              description={`Sets ${name}'s spend to $0.00. Recorded in the audit log.`}
              disabled={pending}
              onConfirm={() => void act("/reset-spend")}
            />
          ) : null}
          {ops.has("resetMemberBudget") ? (
            <ConfirmAction
              label={`Reset budget for ${name}`}
              text="Reset budget"
              title={`Reset budget for ${name}?`}
              description="The member's budget period restarts."
              disabled={pending}
              onConfirm={() => void act("/reset-budget")}
            />
          ) : null}
          {ops.has("disableMember") ? (
            <ActionButton
              label={`Disable ${name}`}
              text="Disable"
              disabled={pending}
              onClick={() => void act("/disable")}
            />
          ) : null}
          {ops.has("enableMember") ? (
            <ActionButton
              label={`Enable ${name}`}
              text="Enable"
              disabled={pending}
              onClick={() => void act("/enable")}
            />
          ) : null}
          {ops.has("setMemberBudget") || ops.has("setMemberLimits") ? (
            <EditMemberLimits
              teamId={teamId}
              oid={oid}
              name={name}
              budgetEnabled={ops.has("setMemberBudget")}
              limitsEnabled={ops.has("setMemberLimits")}
            />
          ) : null}
        </>
      ) : null}
    </span>
  );
}

export function MembersPanel({ teamId }: TeamPanelProps) {
  const detail = useTeamDetail(teamId);
  const members = useLiteLLMQuery(
    ["team", teamId, "members"],
    teamPath(teamId, "/members"),
    LiteLLMMembersResponseSchema,
  );
  const { write, refresh, pending, error } = useTeamWrite(teamId);
  const [nearOnly, setNearOnly] = useState(false);
  const [search, setSearch] = useState("");
  const isMobile = useIsMobile();
  if (detail.status === "unavailable" || members.status === "unavailable") {
    return <Unavailable />;
  }
  if (
    detail.data.configured === false ||
    !detail.data.connected ||
    !members.data.connected
  ) {
    return <NotConnected />;
  }
  const ops = new Set(detail.data.enabledOperations);
  const { items, candidates } = members.data;
  const teamName = detail.data.team.alias ?? "this team";
  const term = search.trim().toLowerCase();
  const shown = items.filter(
    (m) =>
      (!nearOnly ||
        (m.spend !== undefined &&
          m.maxBudget != null &&
          m.maxBudget > 0 &&
          budgetPercent(m.spend, m.maxBudget) >= NEAR_BUDGET_PERCENT)) &&
      (term === "" ||
        (m.name ?? "").toLowerCase().includes(term) ||
        m.email.toLowerCase().includes(term)),
  );
  const actionProps = (member: Member, name: string) => ({
    teamId,
    member,
    name,
    teamName,
    ops,
    pending,
    write,
    canAddToTeam: candidates !== undefined,
    onAdded: () => refresh(["members"]),
  });

  const resettable = items.filter((m) => m.oid).length;

  // Bulk reset: the existing per-member route once per member, each audited
  // there (Design System - Management pages, Bulk reset). Stops at the first
  // failure so its message stays visible.
  async function resetAll() {
    for (const member of items) {
      if (!member.oid) continue;
      const result = await write(
        memberPath(teamId, member.oid, "/reset-spend"),
        "POST",
        undefined,
        ["members"],
        { refetch: false },
      );
      if (!result.ok) break;
    }
    await refresh(["members"]);
  }

  return (
    <div className="flex flex-col gap-3">
      {ops.has("addTeamMember") ? (
        <div>
          <AddMember teamId={teamId} candidates={candidates ?? []} />
        </div>
      ) : null}
      {items.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="search"
            aria-label="Search members"
            placeholder="Search members"
            className="w-full sm:w-64"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button
            variant="outline"
            size="sm"
            aria-pressed={nearOnly}
            onClick={() => setNearOnly((on) => !on)}
          >
            Near or over budget
          </Button>
          {ops.has("resetMemberSpend") ? (
            <ConfirmAction
              label="Reset spend for all members"
              text="Reset spend for all members"
              title="Reset spend for all members?"
              description={`Resets spend for ${resettable} ${resettable === 1 ? "member" : "members"} to $0.00. Recorded in the audit log.`}
              disabled={pending}
              onConfirm={() => void resetAll()}
            />
          ) : null}
        </div>
      ) : null}
      <WriteError message={error} />
      {items.length === 0 ? (
        <Empty>No members in this team.</Empty>
      ) : shown.length === 0 ? (
        <Empty>No members match</Empty>
      ) : isMobile ? (
        <ul role="list" aria-label="Team members" className="space-y-3">
          {shown.map((member) => {
            const name = member.name ?? member.email;
            const budget = (
              <span className="flex flex-col items-start gap-1 font-mono tabular-nums">
                {member.maxBudget == null || member.maxBudget <= 0 ? null : (
                  <span>{formatUsd(member.maxBudget)}</span>
                )}
                {member.spend === undefined ? null : (
                  <BudgetBar spend={member.spend} budget={member.maxBudget} />
                )}
              </span>
            );
            return (
              <li
                key={member.userId}
                className="bg-card text-card-foreground rounded-card space-y-3 border p-4"
              >
                <div className="min-w-0 font-medium break-words">{name}</div>
                <div className="text-muted-foreground text-xs break-words">
                  {member.email}
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div className="min-w-0">
                    <dt className="text-muted-foreground text-xs">Spend</dt>
                    <dd className="font-mono tabular-nums">
                      {member.spend === undefined
                        ? HIDDEN
                        : formatUsd(member.spend)}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-muted-foreground text-xs">Budget</dt>
                    <dd>{budget}</dd>
                  </div>
                </dl>
                <MemberActions {...actionProps(member, name)} />
              </li>
            );
          })}
        </ul>
      ) : (
        <Table>
          <TableCaption className="sr-only">Team members</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead className="text-right">Spend</TableHead>
              <TableHead className="text-right">Budget</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((member) => {
              const name = member.name ?? member.email;
              const budget = (
                <span className="flex flex-col items-end gap-1 font-mono tabular-nums">
                  {member.maxBudget == null || member.maxBudget <= 0 ? null : (
                    <span>{formatUsd(member.maxBudget)}</span>
                  )}
                  {member.spend === undefined ? null : (
                    <BudgetBar spend={member.spend} budget={member.maxBudget} />
                  )}
                </span>
              );
              return (
                <TableRow key={member.userId}>
                  <TableCell>
                    <span className="flex flex-col">
                      <span>{name}</span>
                      <span className="text-muted-foreground text-xs">
                        {member.email}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {member.spend === undefined
                      ? HIDDEN
                      : formatUsd(member.spend)}
                  </TableCell>
                  <TableCell>{budget}</TableCell>
                  <TableCell>
                    <MemberActions {...actionProps(member, name)} />
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
