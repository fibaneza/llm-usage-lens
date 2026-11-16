"use client";

import { LiteLLMMembersResponseSchema } from "@llm-usage-lens/shared";
import { useState } from "react";

import { formatUsd } from "@/components/charts/chart-data";
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

import { NativeSelect } from "./native-select";
import type { TeamPanelProps } from "./panel-props";
import { Empty, NotConnected, Unavailable } from "../LiteLLMSection";
import {
  ActionButton,
  ConfirmAction,
  FormDialog,
  WriteError,
} from "./write-parts";
import { useLiteLLMQuery } from "../use-litellm-query";
import { useTeamDetail } from "../use-team-detail";
import { memberPath, teamPath, useTeamWrite } from "./use-team-write";

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

export function MembersPanel({ teamId }: TeamPanelProps) {
  const detail = useTeamDetail(teamId);
  const members = useLiteLLMQuery(
    ["team", teamId, "members"],
    teamPath(teamId, "/members"),
    LiteLLMMembersResponseSchema,
  );
  const { write, pending, error } = useTeamWrite(teamId);
  if (detail.status === "unavailable" || members.status === "unavailable") {
    return <Unavailable />;
  }
  if (!detail.data.connected || !members.data.connected) {
    return <NotConnected />;
  }
  const ops = new Set(detail.data.enabledOperations);
  const { items } = members.data;

  return (
    <div className="flex flex-col gap-3">
      {ops.has("addTeamMember") ? (
        <div>
          <AddMember
            teamId={teamId}
            candidates={members.data.candidates ?? []}
          />
        </div>
      ) : null}
      <WriteError message={error} />
      {items.length === 0 ? (
        <Empty>No members in this team.</Empty>
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
            {items.map((member) => {
              const name = member.name ?? member.email;
              const oid = member.oid;
              const act = (
                action: string,
                method: "POST" | "DELETE" = "POST",
              ) =>
                oid
                  ? write(memberPath(teamId, oid, action), method, undefined, [
                      "members",
                    ])
                  : Promise.resolve();
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
                    {member.spend === undefined ? "-" : formatUsd(member.spend)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {member.maxBudget == null
                      ? "No limit"
                      : formatUsd(member.maxBudget)}
                  </TableCell>
                  <TableCell>
                    {oid ? (
                      <span className="flex flex-wrap gap-2">
                        {ops.has("removeTeamMember") ? (
                          <ConfirmAction
                            label={`Remove ${name}`}
                            text="Remove"
                            title={`Remove ${name}?`}
                            description="The member loses access to this team's keys."
                            disabled={pending}
                            onConfirm={() => void act("", "DELETE")}
                          />
                        ) : null}
                        {ops.has("resetMemberSpend") ? (
                          <ConfirmAction
                            label={`Reset spend for ${name}`}
                            text="Reset spend"
                            title={`Reset spend for ${name}?`}
                            description="The member's recorded spend returns to zero."
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
                        {ops.has("setMemberBudget") ||
                        ops.has("setMemberLimits") ? (
                          <EditMemberLimits
                            teamId={teamId}
                            oid={oid}
                            name={name}
                            budgetEnabled={ops.has("setMemberBudget")}
                            limitsEnabled={ops.has("setMemberLimits")}
                          />
                        ) : null}
                      </span>
                    ) : null}
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
