import { z } from "zod";

import { Iso8601Schema } from "./schemas/primitives";
import { canonicalUsageIdentity } from "./usage-identity";

// Source: docs/specs/2026-11-10-access-control.md - "Usage-identity mapping
// rules (D27)": a pattern with one `{name}` placeholder over the session name
// and a template for the email. Rules only SUGGEST a link; matching is exact.
export const MAX_IDENTITY_MAP_RULES = 20;
const MAX_PATTERN_LENGTH = 200;
const MAX_TEMPLATE_LENGTH = 254;
const PLACEHOLDER = "{name}";

const EmailSchema = z.email();

function hasOnePlaceholder(value: string): boolean {
  const parts = value.split(PLACEHOLDER);
  return parts.length === 2 && !/[{}]/.test(parts.join(""));
}

export const IdentityMapRuleSchema = z.object({
  pattern: z.string().min(1).max(MAX_PATTERN_LENGTH).refine(hasOnePlaceholder, {
    message: "The pattern needs exactly one {name} placeholder",
  }),
  template: z
    .string()
    .max(MAX_TEMPLATE_LENGTH)
    .refine(
      (t) =>
        hasOnePlaceholder(t) &&
        EmailSchema.safeParse(t.replace(PLACEHOLDER, "x")).success,
      { message: "The template must be an email with one {name} placeholder" },
    ),
});
export type IdentityMapRule = z.infer<typeof IdentityMapRuleSchema>;

// Exported so a route can add `version` without extending a refined object.
export const IdentityMapRuleListSchema = z
  .array(IdentityMapRuleSchema)
  .max(MAX_IDENTITY_MAP_RULES)
  .refine(
    (rules) =>
      new Set(rules.map((r) => r.pattern.toLowerCase())).size === rules.length,
    { message: "Patterns must be unique" },
  );

export const IdentityMapRulesInputSchema = z.object({
  rules: IdentityMapRuleListSchema,
});

export const IdentityMapRulesSchema = z.object({
  rules: z.array(IdentityMapRuleSchema),
  version: z.number().int().min(0),
  updatedAt: Iso8601Schema,
});
export type IdentityMapRules = z.infer<typeof IdentityMapRulesSchema>;

const escapeRegExp = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function compile(pattern: string): RegExp {
  const [prefix = "", suffix = ""] = pattern.split(PLACEHOLDER);
  return new RegExp(
    `^${escapeRegExp(prefix)}([^\\s@/:]+)${escapeRegExp(suffix)}$`,
    "i",
  );
}

type RuleMatch = { email: string; pattern: string; index: number };

function matchRule(
  rules: readonly IdentityMapRule[],
  key: string,
): RuleMatch | null {
  const trimmed = key.trim();
  if (trimmed === "" || canonicalUsageIdentity(trimmed).kind === "person") {
    return null;
  }
  const sessionName = trimmed.split(/[/:]/).pop() ?? "";
  for (const [index, rule] of rules.entries()) {
    const match = compile(rule.pattern).exec(sessionName);
    if (match?.[1] === undefined) continue;
    const name = match[1];
    return {
      email: rule.template.replace(PLACEHOLDER, () => name).toLowerCase(),
      pattern: rule.pattern,
      index,
    };
  }
  return null;
}

export function mapUsageKeyToEmail(
  rules: readonly IdentityMapRule[],
  key: string,
): { email: string; pattern: string } | null {
  const match = matchRule(rules, key);
  return match ? { email: match.email, pattern: match.pattern } : null;
}

export type IdentityLinkSuggestion = {
  pattern: string;
  usageKey: string;
  email: string;
  oid: string;
};

export function suggestIdentityLinks(input: {
  rules: readonly IdentityMapRule[];
  usageKeys: readonly string[];
  identities: readonly { oid: string; email?: string | undefined }[];
  claimedKeys: readonly string[];
}): IdentityLinkSuggestion[] {
  const byEmail = new Map<string, string[]>();
  for (const { oid, email } of input.identities) {
    const normalised = email?.trim().toLowerCase();
    if (!normalised) continue;
    byEmail.set(normalised, [...(byEmail.get(normalised) ?? []), oid]);
  }
  const claimed = new Set(input.claimedKeys.map((k) => k.trim().toLowerCase()));

  const seen = new Set<string>();
  const found: (IdentityLinkSuggestion & { index: number })[] = [];
  for (const raw of input.usageKeys) {
    const usageKey = raw.trim().toLowerCase();
    if (seen.has(usageKey)) continue;
    seen.add(usageKey);
    if (claimed.has(usageKey)) continue;
    const match = matchRule(input.rules, raw);
    if (!match) continue;
    const owners = byEmail.get(match.email);
    const oid = owners?.length === 1 ? owners[0] : undefined;
    if (oid === undefined) continue;
    found.push({
      pattern: match.pattern,
      usageKey,
      email: match.email,
      oid,
      index: match.index,
    });
  }
  return found
    .sort(
      (a, b) =>
        a.index - b.index ||
        (a.usageKey < b.usageKey ? -1 : a.usageKey > b.usageKey ? 1 : 0),
    )
    .map(({ pattern, usageKey, email, oid }) => ({
      pattern,
      usageKey,
      email,
      oid,
    }));
}
