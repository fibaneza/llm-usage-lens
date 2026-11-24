import { createHash } from "node:crypto";

import {
  matchLiteLLMUser,
  normalizeEmail,
  ssoPendingKey,
} from "@/lib/data/access/litellm-match";

// Source: docs/specs/2026-11-10-access-control.md - "LiteLLM user sync":
// *Users* table (the outcomes and skip reasons), *Same person* (the Entra id
// first, then the email; nothing linked when the keys disagree), *Pending
// LiteLLM links*, *Preview and apply* (the plan hash), *Match keys per
// sign-in mode*; tests T-SY1, T-SY4, T-SY5, T-SM1, T-SM2. Pure: no I/O, no
// time. `sso_user_id` is read only to compare and never copied into a row.

export const PERSON_ROLES: readonly string[] = [
  "internal_user",
  "internal_user_viewer",
];

export type SyncSkipReason =
  | "no-email"
  | "duplicate-email"
  | "ambiguous-identity"
  | "privileged"
  | "service-user"
  | "claimed"
  | "identity-linked-elsewhere"
  | "own-identity";

export type PlanUser = {
  userId: string;
  email: string | null;
  role: string | null;
  ssoUserId: string | null;
  // The LiteLLM teams the user is in (for the people the sync cannot place).
  teams?: string[];
};

export type PlanPerson = {
  oid: string;
  authMethod: "entra" | "password";
  tid?: string;
  upn?: string;
  email?: string;
  expectedOid?: string;
  litellmUserId: string | null;
};

export type PlanPending = { key: string; litellmUserId: string };

export type MatchedKey = "oid" | "email";

export type PlanRow = {
  litellmUserId: string;
  outcome:
    | "link-existing"
    | "create-pending"
    | "already-linked"
    | "already-pending"
    | "skip";
  reason?: SyncSkipReason;
  oid?: string;
  key?: string;
  matchedKey?: MatchedKey;
};

export type ClassifyInput = {
  users: readonly PlanUser[];
  people: readonly PlanPerson[];
  pending: readonly PlanPending[];
  // LiteLLM user id -> owner of its claim: an identity oid or a pending key.
  claims: Readonly<Record<string, string>>;
  tenant: string | null;
  serviceUserId: string | null;
  callerOid: string | null;
};

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const validEmail = (value: string | null): string | null => {
  const email = normalizeEmail(value);
  return EMAIL_SHAPE.test(email) ? email : null;
};

const ssoKeyOf = (u: PlanUser): string | null => {
  const sso = u.ssoUserId?.trim().toLowerCase();
  return sso && !sso.startsWith("local:") ? ssoPendingKey(sso) : null;
};

// The pending links whose LiteLLM user is gone from a complete list, is no
// person any more, or no longer has the key the placeholder is stored under.
// Only a candidate: the sync confirms each with `getUser` before it removes
// one (Access Control - LiteLLM user sync, Clean-up of dashboard
// placeholders).
export function staleCandidates(
  pending: readonly PlanPending[],
  users: readonly PlanUser[],
  serviceUserId: string | null,
): PlanPending[] {
  const byId = new Map(users.map((u) => [u.userId, u]));
  return pending.filter((p) => {
    const u = byId.get(p.litellmUserId);
    if (!u) return true;
    if (
      u.userId === serviceUserId ||
      u.role === null ||
      !PERSON_ROLES.includes(u.role)
    ) {
      return true;
    }
    return ![validEmail(u.email), ssoKeyOf(u)].includes(p.key);
  });
}

export function classifyLiteLLMUsers(input: ClassifyInput): PlanRow[] {
  const { users, people, pending, claims, tenant } = input;
  const eligible = (u: PlanUser) =>
    u.userId !== input.serviceUserId &&
    u.role !== null &&
    PERSON_ROLES.includes(u.role);

  const emailCount = new Map<string, number>();
  for (const u of users) {
    const email = validEmail(u.email);
    if (email && eligible(u)) {
      emailCount.set(email, (emailCount.get(email) ?? 0) + 1);
    }
  }

  const pendingByUser = new Map(pending.map((p) => [p.litellmUserId, p.key]));

  const rows = users.map((u): PlanRow => {
    const skip = (reason: SyncSkipReason): PlanRow => ({
      litellmUserId: u.userId,
      outcome: "skip",
      reason,
    });
    if (u.userId === input.serviceUserId) return skip("service-user");
    if (!eligible(u)) return skip("privileged");

    const email = validEmail(u.email);
    if (email && (emailCount.get(email) ?? 0) > 1) {
      return skip("duplicate-email");
    }

    const entra = new Set<string>();
    const byEmail = new Set<string>();
    for (const p of people) {
      const m = matchLiteLLMUser(
        { ...p, email: p.email ?? null, upn: p.upn ?? null },
        { userId: u.userId, email: u.email, ssoUserId: u.ssoUserId },
        tenant,
      );
      if (m.entraId) entra.add(p.oid);
      if (m.email) byEmail.add(p.oid);
    }
    const matched = new Set([...entra, ...byEmail]);
    if (matched.size > 1) return skip("ambiguous-identity");

    const [oid] = matched;
    const owner = claims[u.userId];
    const ownPending = pendingByUser.get(u.userId);
    if (oid !== undefined) {
      const person = people.find((p) => p.oid === oid);
      if (oid === input.callerOid) return skip("own-identity");
      if (person?.litellmUserId === u.userId) {
        return { litellmUserId: u.userId, outcome: "already-linked", oid };
      }
      if (person?.litellmUserId) return skip("identity-linked-elsewhere");
      if (owner !== undefined && owner !== ownPending) return skip("claimed");
      return {
        litellmUserId: u.userId,
        outcome: "link-existing",
        oid,
        matchedKey: entra.has(oid) ? "oid" : "email",
      };
    }

    if (!email) return skip("no-email");
    const sso = ssoKeyOf(u);
    const key = sso ?? email;
    if (ownPending !== undefined) {
      return [email, sso].includes(ownPending)
        ? {
            litellmUserId: u.userId,
            outcome: "already-pending",
            key: ownPending,
          }
        : skip("claimed");
    }
    if (owner !== undefined) return skip("claimed");
    return { litellmUserId: u.userId, outcome: "create-pending", key };
  });

  // One identity matched by two LiteLLM users links neither.
  const perOid = new Map<string, number>();
  for (const r of rows) {
    if (r.outcome === "link-existing" && r.oid) {
      perOid.set(r.oid, (perOid.get(r.oid) ?? 0) + 1);
    }
  }
  return rows.map((r) =>
    r.outcome === "link-existing" && r.oid && (perOid.get(r.oid) ?? 0) > 1
      ? {
          litellmUserId: r.litellmUserId,
          outcome: "skip",
          reason: "ambiguous-identity",
        }
      : r,
  );
}

export type HashRow = {
  litellmUserId: string;
  outcome: string;
  reason?: string;
  oid?: string;
  key?: string;
  matchedKey?: string;
  teamId?: string;
};

// SHA-256 over the changes the plan would make, independent of row order.
export function planHash(rows: readonly HashRow[]): string {
  const lines = rows
    .map((r) =>
      JSON.stringify([
        r.litellmUserId,
        r.outcome,
        r.reason ?? "",
        r.oid ?? "",
        r.key ?? "",
        r.matchedKey ?? "",
        r.teamId ?? "",
      ]),
    )
    .sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}
