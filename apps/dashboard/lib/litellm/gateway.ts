import "server-only";

import { trace } from "@opentelemetry/api";
import { liteLLMEdition } from "@llm-usage-lens/shared";
import { z } from "zod";

import { env } from "@/env";

import { findAllowlistedRoute, isValidPathParam } from "./allowlist";
import type { LiteLLMMethod } from "./allowlist";
import { callLiteLLM } from "./client";
import type { LiteLLMResponse } from "./client";

// Source: docs/specs/2026-11-10-litellm.md — "Gateway guardrails" items 1-3
// (the one outbound choke point: method + route template checked against the
// allowlist before any network call, `LiteLLMRouteNotAllowed` recorded on the
// span and never sent; no generic passthrough and no caller-supplied path;
// path parameters validated, then encodeURIComponent-encoded), "Audit" item 2
// / LD14 (litellm-changed-by built from the session, validated), "Edition"
// (LT15: Enterprise-only routes refused on OSS with no call), threats LT3,
// LT7, LT14, LT19. Errors carry fixed text only: no caller input is echoed.

const CHANGED_BY_PREFIX = "llm-usage-lens:";
const MAX_ACTOR_LENGTH = 256;
const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;

export class LiteLLMRouteNotAllowed extends Error {
  constructor(message = "The LiteLLM request is not allowed") {
    super(message);
    this.name = "LiteLLMRouteNotAllowed";
  }
}

// A toggle is off (OPERATION_DISABLED) or the operation needs Enterprise on
// an OSS deployment (OPERATION_UNAVAILABLE). Both are 403, thrown before any
// request.
export class LiteLLMOperationRefused extends Error {
  readonly status = 403 as const;
  constructor(readonly code: "OPERATION_DISABLED" | "OPERATION_UNAVAILABLE") {
    super(
      code === "OPERATION_DISABLED"
        ? "This LiteLLM operation is disabled"
        : "This LiteLLM operation is unavailable on this edition",
    );
    this.name = "LiteLLMOperationRefused";
  }
}

export type LiteLLMActor = { oid: string; email?: string | null };

export const LiteLLMActorSchema = z.strictObject({
  oid: z.string().min(1),
  email: z.string().nullish(),
});

export type AllowlistedRequest = {
  method: LiteLLMMethod;
  template: string;
  params?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  actor?: LiteLLMActor;
};

// Strict: an unknown field (a `path`, `headers`, `changedBy`) is refused.
const RequestSchema = z.strictObject({
  method: z.string(),
  template: z.string(),
  params: z.record(z.string(), z.string()).optional(),
  query: z
    .record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean()]).optional(),
    )
    .optional(),
  body: z.unknown().optional(),
  actor: LiteLLMActorSchema.optional(),
});

function refuse(error: Error): never {
  trace.getActiveSpan()?.recordException(error);
  throw error;
}

function changedBy(actor: LiteLLMActor | undefined): string {
  if (!actor) refuse(new LiteLLMRouteNotAllowed("A write needs an actor"));
  const email = actor.email?.trim().toLowerCase();
  const who = email ? email : actor.oid;
  if (
    who.length > MAX_ACTOR_LENGTH ||
    !PRINTABLE_ASCII.test(who) ||
    // Defence in depth: printable ASCII already excludes CR and LF.
    /[\r\n]/.test(who)
  ) {
    refuse(new LiteLLMRouteNotAllowed("The actor cannot be attributed"));
  }
  return `${CHANGED_BY_PREFIX}${who}`;
}

function fillTemplate(
  template: string,
  params: Record<string, string> | undefined,
): string {
  const names = [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "");
  const given = params ?? {};
  if (Object.keys(given).some((name) => !names.includes(name))) {
    refuse(new LiteLLMRouteNotAllowed("Unexpected path parameter"));
  }
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = given[name];
    if (value === undefined || !isValidPathParam(name, value)) {
      refuse(new LiteLLMRouteNotAllowed("Invalid path parameter"));
    }
    return encodeURIComponent(value);
  });
}

function queryString(query: AllowlistedRequest["query"]): string {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(query ?? {})) {
    if (value !== undefined) search.set(name, String(value));
  }
  const text = search.toString();
  return text === "" ? "" : `?${text}`;
}

// The only function that sends a request to LiteLLM (besides the client it
// wraps). `options.baseUrl` is for the connection test's candidate URL.
export async function callAllowlisted(
  request: AllowlistedRequest,
  options: { baseUrl?: string } = {},
): Promise<LiteLLMResponse> {
  const parsed = RequestSchema.safeParse(request);
  if (!parsed.success) {
    refuse(new LiteLLMRouteNotAllowed("Malformed LiteLLM request"));
  }
  const { method, template, params, query, body, actor } = parsed.data;

  const route = findAllowlistedRoute(method, template);
  if (!route) refuse(new LiteLLMRouteNotAllowed());
  if (route.enterpriseOnly && liteLLMEdition(env.APP_ENV) === "oss") {
    refuse(new LiteLLMOperationRefused("OPERATION_UNAVAILABLE"));
  }

  const path = fillTemplate(template, params);
  const headers =
    route.method === "GET"
      ? undefined
      : { "litellm-changed-by": changedBy(actor) };

  return callLiteLLM(
    {
      method: route.method,
      path: `${path}${queryString(query)}`,
      ...(body === undefined ? {} : { body }),
      ...(headers ? { headers } : {}),
    },
    options,
  );
}
