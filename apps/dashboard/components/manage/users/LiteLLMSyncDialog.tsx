"use client";

import {
  LiteLLMSyncBodySchema,
  LiteLLMSyncPlanResponseSchema,
  LiteLLMSyncResultSchema,
  type LiteLLMSyncUserRow,
} from "@llm-usage-lens/shared";
import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiRequestError, fetchApi, mutateApi } from "@/lib/query/fetch-api";

// Source: Design System - "Sync from LiteLLM" (unit SYNC1); Access Control -
// "LiteLLM user sync" (Preview and apply; Teams). The dialog only reads on
// open (GET /api/identities/litellm-sync) and applies the previewed plan hash
// with Apply or Continue; the sync never writes to LiteLLM, so the deletion is
// called "clean-up of dashboard placeholders". Both responses are parsed with
// the one exported schema each (Rule 10.4); a result row carries no email, so
// every email comes from the preview by litellmUserId.
const PATH = "/api/identities/litellm-sync";
const USERS_LIST_HREF = "/dashboard/manage/users";
const PAGE = 25;

const PlanSchema = LiteLLMSyncPlanResponseSchema;
type Plan = Extract<
  z.infer<typeof LiteLLMSyncPlanResponseSchema>,
  { configured: true }
>;

const ResultSchema = LiteLLMSyncResultSchema;
type Result = z.infer<typeof LiteLLMSyncResultSchema>;
type LiteLLMSyncResultRow = Result["results"]["users"][number];

const REASON_WORDS: Record<string, string> = {
  "no-email": "No email in LiteLLM",
  "duplicate-email": "Two LiteLLM users have the same email",
  "ambiguous-identity":
    "Ambiguous: two dashboard users share this email, or the Entra id and the email point at different people",
  privileged: "LiteLLM admin user",
  "service-user": "Service user",
  claimed: "Already linked to someone else",
  "identity-linked-elsewhere": "Already linked to another LiteLLM user",
  "own-identity": "Your own user",
  "multiple-teams": "In more than one team linked to LiteLLM",
  "other-team": "Already in another team",
  "no-linked-team": "Not in any team linked to a LiteLLM team",
  "removal-guard": "Clean-up paused: too many placeholders would be removed",
};
const OUTCOME_WORDS: Record<string, string> = {
  "link-existing": "Linked",
  "create-pending": "Added as pending",
  "already-linked": "Already linked",
  "already-pending": "Already pending",
  "remove-pending": "Placeholder cleaned up",
  skip: "Skipped",
  add: "Added to the team",
  "add-member": "Added to the team",
  "add-pending-member": "Added to the team as pending",
};
// Only the API's own error answer is shown; a parse or network failure would
// print schema internals on screen (Rule 50.6, S20).
const messageOf = (cause: unknown, fallback: string) =>
  cause instanceof ApiRequestError ? cause.message : fallback;
const words = (map: Record<string, string>, key: string) => map[key] ?? key;

const NOTICE_CHANGED = "The plan changed — review it again";
const NOTICE_RUNNING =
  "A sync is already running. Wait for it to finish, then try again.";
const NOTICE_TRUNCATED =
  "The plan is truncated: it is larger than one run may apply, so it cannot be applied.";

type Row = { key: string; text: string; detail?: string };

function OutcomeGroup({
  label,
  rows,
  footer,
}: {
  label: string;
  rows: Row[];
  footer?: ReactNode;
}) {
  const [shown, setShown] = useState(PAGE);
  if (rows.length === 0) return null;
  return (
    <section role="group" aria-label={label} className="flex flex-col gap-1">
      <h3 className="text-sm font-semibold">
        {label} <span className="text-muted-foreground">({rows.length})</span>
      </h3>
      <ul className="text-cell flex flex-col gap-0.5">
        {rows.slice(0, shown).map((row) => (
          <li key={row.key} className="flex flex-wrap gap-x-2">
            <span className="min-w-0 break-all">{row.text}</span>
            {row.detail ? (
              <span className="text-muted-foreground">{row.detail}</span>
            ) : null}
          </li>
        ))}
      </ul>
      {footer}
      {rows.length > shown ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => setShown((n) => n + PAGE)}
        >
          Show more
        </Button>
      ) : null}
    </section>
  );
}

function usersWhere(
  users: readonly LiteLLMSyncUserRow[],
  outcome: LiteLLMSyncUserRow["outcome"],
  detail: (row: LiteLLMSyncUserRow) => string | undefined,
): Row[] {
  return users
    .filter((u) => u.outcome === outcome)
    .map((u) => {
      const d = detail(u);
      return {
        key: u.litellmUserId,
        text: u.email,
        ...(d ? { detail: d } : {}),
      };
    });
}

const COUNT_LABELS = [
  ["toLink", "To link"],
  ["toPend", "To add as pending"],
  ["alreadyLinked", "Already linked"],
  ["skipped", "Skipped"],
  ["memberships", "Memberships to add"],
] as const;

function PreviewBody({
  plan,
  emails,
}: {
  plan: Plan;
  emails: Map<string, string>;
}) {
  const who = (id: string) => emails.get(id) ?? id;
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {COUNT_LABELS.map(([key, label]) => (
          <div
            key={key}
            data-testid={`sync-count-${key}`}
            className="rounded-control flex flex-col border px-2 py-1"
          >
            <dt className="text-muted-foreground text-xs">{label}</dt>
            <dd className="font-mono text-lg tabular-nums">
              {plan.counts[key]}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-muted-foreground text-cell">
        Nothing is written to LiteLLM. The clean-up of dashboard placeholders
        only touches the dashboard.
      </p>
      <OutcomeGroup
        label="To link"
        rows={usersWhere(plan.users, "link-existing", (u) =>
          u.outcome === "link-existing"
            ? u.matchedKey === "oid"
              ? "matched by Entra id"
              : "matched by email"
            : undefined,
        )}
      />
      <OutcomeGroup
        label="To add as pending"
        rows={usersWhere(plan.users, "create-pending", () => undefined)}
      />
      <OutcomeGroup
        label="Already linked"
        rows={usersWhere(plan.users, "already-linked", () => undefined)}
      />
      <OutcomeGroup
        label="Already pending"
        rows={usersWhere(plan.users, "already-pending", () => undefined)}
      />
      <OutcomeGroup
        label="Clean-up of dashboard placeholders"
        rows={usersWhere(plan.users, "remove-pending", (u) =>
          u.outcome === "remove-pending" && u.reason
            ? words(REASON_WORDS, u.reason)
            : undefined,
        )}
      />
      <OutcomeGroup
        label="Skipped"
        rows={usersWhere(plan.users, "skip", (u) =>
          u.outcome === "skip" ? words(REASON_WORDS, u.reason) : undefined,
        )}
      />
      <OutcomeGroup
        label="Memberships to add"
        rows={plan.memberships.map((m) => ({
          key: `${m.litellmUserId}:${m.teamId}`,
          text: who(m.litellmUserId),
          detail: `${words(OUTCOME_WORDS, m.outcome)} (team ${m.teamId})${
            m.reason ? `: ${words(REASON_WORDS, m.reason)}` : ""
          }`,
        }))}
      />
      <OutcomeGroup
        label="Drift"
        rows={plan.drift.map((d) => ({
          key: `${d.kind}:${d.oid}:${d.teamId ?? ""}`,
          text: d.oid,
          detail:
            d.kind === "not-in-litellm"
              ? "Not in LiteLLM"
              : `Not in LiteLLM's team for dashboard team ${d.teamId ?? ""}`.trim(),
        }))}
      />
    </div>
  );
}

function ResultBody({
  result,
  emails,
}: {
  result: Result;
  emails: Map<string, string>;
}) {
  const who = (id: string) => emails.get(id) ?? id;
  const toRow = (r: LiteLLMSyncResultRow): Row => ({
    key: `${r.litellmUserId}:${r.outcome}`,
    text: who(r.litellmUserId),
    detail:
      r.status === "refused"
        ? `Refused${r.reason ? `: ${words(REASON_WORDS, r.reason)}` : ""}`
        : words(OUTCOME_WORDS, r.outcome),
  });
  return (
    <div className="flex flex-col gap-3">
      <OutcomeGroup label="Result" rows={result.results.users.map(toRow)} />
      <OutcomeGroup
        label="Memberships added"
        rows={result.results.memberships.map(toRow)}
      />
      {result.results.notPlaced.length > 0 ? (
        <OutcomeGroup
          label="Not placed in a team"
          rows={result.results.notPlaced.map((p) => ({
            key: p.litellmUserId,
            text: who(p.litellmUserId),
            detail: words(REASON_WORDS, p.reason),
          }))}
          footer={
            <p className="text-cell text-muted-foreground">
              Place them from the{" "}
              <Link href={USERS_LIST_HREF} className="underline">
                Users list
              </Link>
              .
            </p>
          }
        />
      ) : null}
    </div>
  );
}

export function LiteLLMSyncDialog({ onClose }: { onClose: () => void }) {
  const [plan, setPlan] = useState<z.infer<typeof PlanSchema> | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seen, setSeen] = useState<Map<string, string>>(() => new Map());

  const remember = useCallback((next: z.infer<typeof PlanSchema>) => {
    if (!next.configured) return;
    setSeen((prev) => {
      const map = new Map(prev);
      for (const u of next.users) map.set(u.litellmUserId, u.email);
      return map;
    });
  }, []);

  const read = useCallback(async () => {
    try {
      const next = await fetchApi(PATH, PlanSchema);
      remember(next);
      setPlan(next);
      setError(null);
      return next;
    } catch (cause) {
      setError(messageOf(cause, "The preview could not load."));
      return null;
    } finally {
      setLoading(false);
    }
  }, [remember]);

  const load = useCallback(() => {
    setLoading(true);
    return read();
  }, [read]);

  useEffect(() => {
    let live = true;
    fetchApi(PATH, PlanSchema)
      .then((next) => {
        if (!live) return;
        remember(next);
        setPlan(next);
      })
      .catch((cause: unknown) => {
        if (live) setError(messageOf(cause, "The preview could not load."));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [remember]);

  const apply = useCallback(
    async (planHash: string) => {
      setBusy(true);
      setNotice(null);
      setError(null);
      try {
        const body = LiteLLMSyncBodySchema.parse({ planHash });
        setResult(await mutateApi(PATH, "POST", body, ResultSchema));
      } catch (cause) {
        if (cause instanceof ApiRequestError && cause.status === 409) {
          if (cause.code === "PLAN_CHANGED") {
            setNotice(NOTICE_CHANGED);
            setResult(null);
            await load();
          } else if (cause.code === "SYNC_RUNNING") {
            setNotice(NOTICE_RUNNING);
          } else if (cause.code === "PLAN_TRUNCATED") {
            setPlan((p) => (p?.configured ? { ...p, truncated: true } : p));
          } else {
            setError(cause.message);
          }
        } else {
          setError(messageOf(cause, "The sync did not run."));
        }
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const onContinue = useCallback(async () => {
    setBusy(true);
    const next = await load();
    setBusy(false);
    if (next?.configured && !next.truncated) await apply(next.planHash);
  }, [load, apply]);

  const emails = useMemo(() => seen, [seen]);
  const configured = plan?.configured ? plan : null;
  const truncated = configured?.truncated ?? false;

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Sync from LiteLLM</DialogTitle>
          <DialogDescription>
            Link LiteLLM users to dashboard people by Entra id or email, and
            keep the others as pending until they sign in. Review the plan, then
            apply it.
          </DialogDescription>
        </DialogHeader>

        {notice ? (
          <p aria-live="polite" className="flex items-center gap-2 text-sm">
            <TriangleAlert aria-hidden className="size-4 shrink-0" />
            {notice}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}

        {loading && !result ? (
          <p role="status" className="text-muted-foreground text-sm">
            Loading the preview…
          </p>
        ) : null}

        {!loading && plan && !plan.configured ? (
          <p className="text-muted-foreground text-sm">
            LiteLLM not configured
          </p>
        ) : null}

        {result ? (
          <>
            <ResultBody result={result} emails={emails} />
            {result.remaining > 0 ? (
              <p className="text-sm">
                {result.remaining} changes remain. Continue to apply the next
                batch.
              </p>
            ) : null}
          </>
        ) : configured && !loading ? (
          <>
            {truncated ? <p className="text-sm">{NOTICE_TRUNCATED}</p> : null}
            <PreviewBody plan={configured} emails={emails} />
          </>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
          {result && result.remaining > 0 ? (
            <Button
              type="button"
              disabled={busy || loading}
              onClick={() => void onContinue()}
            >
              Continue
            </Button>
          ) : null}
          {!result && configured ? (
            <Button
              type="button"
              disabled={busy || loading || truncated}
              onClick={() => void apply(configured.planHash)}
            >
              Apply
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
