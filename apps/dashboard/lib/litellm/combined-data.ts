import "server-only";

import type { LiteLLMOperationName } from "@llm-usage-lens/shared";
import { trace } from "@opentelemetry/api";
import type { Session } from "next-auth";
import { z } from "zod";

import { getIdentityLink } from "@/lib/data/access/identity-links";
import { getBedrockGateway } from "@/lib/data/litellm/bedrock-gateway";

import { LiteLLMError } from "./client";
import { isGatewayConfigured } from "./combined";
import type { Gateway, LiteLLMDailyRow, LiteLLMSide } from "./combined";
import {
  findUserByEmail,
  getTeamDailySpend,
  getUserDailySpend,
  listProxyTeams,
} from "./operations";

// Source: docs/specs/2026-11-10-litellm.md - "Combined usage and My usage
// (L6)": Read per request, never cached (the gateway config, LT33), LiteLLM
// reads used (organisation: the LD33 teams total; team: LD36; person: the
// paged user read), States. The loader the combined routes share; the
// computation itself is combined.ts.

const MAX_TEAMS_PER_READ = 200;

export type LoadedGateway = Gateway & { configured: boolean };

export async function loadGateway(): Promise<LoadedGateway> {
  const stored = await getBedrockGateway();
  const gateway: Gateway = {
    principals: stored?.principals ?? [],
    accountIds: stored?.accountIds ?? [],
  };
  return { ...gateway, configured: isGatewayConfigured(gateway) };
}

const Spend = z.looseObject({ spend: z.number().nullish() });
const DailyRowSchema = z.looseObject({
  date: z.string().optional(),
  metrics: Spend.optional(),
  breakdown: z
    .looseObject({
      providers: z
        .record(z.string(), z.looseObject({ metrics: Spend.optional() }))
        .optional(),
    })
    .optional(),
});

// Loose upstream rows reduced to the fields the computation reads; a
// mismatch is contract drift (LITELLM_UNAVAILABLE).
export function reduceCombinedRows(
  results: readonly unknown[],
): LiteLLMDailyRow[] {
  return results.map((raw) => {
    const parsed = DailyRowSchema.safeParse(raw);
    if (!parsed.success) throw new LiteLLMError("contract_drift");
    const row = parsed.data;
    return {
      ...(row.date !== undefined ? { date: row.date } : {}),
      metrics: { spend: row.metrics?.spend ?? 0 },
      breakdown: {
        providers: Object.fromEntries(
          Object.entries(row.breakdown?.providers ?? {}).map(([p, v]) => [
            p,
            { metrics: { spend: v.metrics?.spend ?? 0 } },
          ]),
        ),
      },
    };
  });
}

type Range = { startDate: string; endDate: string };

// The LD33 total: one aggregated read over every proxy team (chunks of the
// operation's 200-team limit). Spend on keys outside any team is not in it.
export async function readOrganisationSide(range: Range): Promise<LiteLLMSide> {
  const ids = (await listProxyTeams()).map((t) => t.team_id);
  const rows: LiteLLMDailyRow[] = [];
  for (let i = 0; i < ids.length; i += MAX_TEAMS_PER_READ) {
    const daily = await getTeamDailySpend({
      litellmTeamIds: ids.slice(i, i + MAX_TEAMS_PER_READ),
      ...range,
    });
    rows.push(...reduceCombinedRows(daily.results));
  }
  return { kind: "rows", rows };
}

export async function readTeamSide(
  litellmTeamId: string,
  range: Range,
): Promise<LiteLLMSide> {
  const daily = await getTeamDailySpend({ litellmTeamId, ...range });
  return { kind: "rows", rows: reduceCombinedRows(daily.results) };
}

export async function readPersonSide(
  litellmUserId: string,
  range: Range,
): Promise<LiteLLMSide> {
  const daily = await getUserDailySpend({ litellmUserId, ...range });
  return { kind: "rows", rows: reduceCombinedRows(daily.results) };
}

const EmailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

// The caller's LiteLLM user: the identity link's id, else the session email
// looked up read-only (best effort, as /api/litellm/me; LiteLLM's id is used
// as returned). `null` when there is none.
export async function resolveOwnLiteLLMUserId(
  session: Session,
  enabled: readonly LiteLLMOperationName[],
): Promise<string | null> {
  const link = await getIdentityLink(session.user.oid);
  if (link?.litellmUserId) return link.litellmUserId;
  const parsed = EmailSchema.safeParse(session.user.email);
  if (!parsed.success || !enabled.includes("findUserByEmail")) return null;
  const email = parsed.data;
  try {
    const found = await findUserByEmail({ email });
    return (
      found.users.find((u) => u.user_email?.toLowerCase() === email)?.user_id ??
      null
    );
  } catch (error) {
    if (!(error instanceof LiteLLMError)) throw error;
    trace.getActiveSpan()?.addEvent("litellm.find_user_by_email_failed");
    return null;
  }
}
