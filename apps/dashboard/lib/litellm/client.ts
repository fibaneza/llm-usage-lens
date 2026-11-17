import "server-only";

import { env } from "@/env";
import { getLiteLLMConnection } from "@/lib/data/litellm/connection";

import { parseAllowedHosts, validateLiteLLMBaseUrl } from "./base-url";

// Source: docs/specs/2026-11-10-litellm.md — "Security architecture" items 1,
// 5, 7, 8 and threats LT1, LT6, LT12: the one place the service key is read
// and the only code that calls LiteLLM. Bearer key; base URL from the stored
// connection (or an explicit candidate) checked against LITELLM_ALLOWED_HOSTS;
// 10 s timeout; GET retried only on network, timeout or 5xx (<= 3 attempts);
// writes and 401 never retried; redirects never followed. Errors carry a
// fixed message and a status code only: never an upstream body, the key or
// the URL, and nothing is logged or traced.

const TIMEOUT_MS = 10_000;
const MAX_GET_ATTEMPTS = 3;
const BACKOFF_MS = [250, 500] as const;

export type LiteLLMErrorDetail =
  | "not_configured"
  | "invalid_base_url"
  | "unauthorised"
  | "routes_out_of_date"
  | "upstream_error"
  | "unreachable"
  | "timeout"
  | "contract_drift";

const MESSAGES: Record<LiteLLMErrorDetail, string> = {
  not_configured: "LiteLLM is not configured",
  invalid_base_url: "The LiteLLM base URL is not permitted",
  unauthorised: "LiteLLM rejected the service key",
  routes_out_of_date: "LiteLLM refused a route the service key must allow",
  upstream_error: "LiteLLM returned an error",
  unreachable: "LiteLLM is unreachable",
  timeout: "LiteLLM did not answer in time",
  contract_drift: "LiteLLM returned an unexpected response",
};

export class LiteLLMError extends Error {
  readonly code = "LITELLM_UNAVAILABLE" as const;
  constructor(
    readonly detail: LiteLLMErrorDetail,
    readonly status?: number,
  ) {
    super(MESSAGES[detail]);
    this.name = "LiteLLMError";
  }
}

export type LiteLLMRequest = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  // Built by the gateway only (litellm-changed-by); never caller input.
  headers?: Readonly<Record<string, string>>;
};

export type LiteLLMResponse = { status: number; body: unknown };

export function isServiceKeyConfigured(): boolean {
  return !!env.LITELLM_SERVICE_KEY;
}

export function allowedHostsFromEnv(): string[] {
  return parseAllowedHosts(env.LITELLM_ALLOWED_HOSTS);
}

function detailForStatus(status: number): LiteLLMErrorDetail {
  if (status === 401) return "unauthorised";
  if (status === 403) return "routes_out_of_date";
  return "upstream_error";
}

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

async function attempt(
  url: string,
  key: string,
  request: LiteLLMRequest,
): Promise<LiteLLMResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const hasBody = request.body !== undefined;
    const res = await fetch(url, {
      method: request.method,
      headers: {
        ...request.headers,
        authorization: `Bearer ${key}`,
        accept: "application/json",
        ...(hasBody ? { "content-type": "application/json" } : {}),
      },
      ...(hasBody ? { body: JSON.stringify(request.body) } : {}),
      redirect: "manual",
      cache: "no-store",
      signal: controller.signal,
    });
    if (res.status < 200 || res.status >= 300) {
      await res.body?.cancel().catch(() => undefined);
      throw new LiteLLMError(detailForStatus(res.status), res.status);
    }
    const text = await res.text();
    let body: unknown = null;
    if (text !== "") {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }
    return { status: res.status, body };
  } catch (error) {
    if (error instanceof LiteLLMError) throw error;
    throw new LiteLLMError(
      controller.signal.aborted ? "timeout" : "unreachable",
    );
  } finally {
    clearTimeout(timer);
  }
}

function retryable(error: LiteLLMError): boolean {
  return (
    error.detail === "unreachable" ||
    error.detail === "timeout" ||
    (error.detail === "upstream_error" && (error.status ?? 0) >= 500)
  );
}

// LD37: configured means a service key and a stored connection; the same two
// `not_configured` cases as callLiteLLM, checked without calling LiteLLM.
export async function isLiteLLMConfigured(): Promise<boolean> {
  if (!env.LITELLM_SERVICE_KEY) return false;
  return (await getLiteLLMConnection()) !== null;
}

export async function callLiteLLM(
  request: LiteLLMRequest,
  options: { baseUrl?: string } = {},
): Promise<LiteLLMResponse> {
  const key = env.LITELLM_SERVICE_KEY;
  if (!key) throw new LiteLLMError("not_configured");
  if (!request.path.startsWith("/")) {
    throw new LiteLLMError("invalid_base_url");
  }
  const raw = options.baseUrl ?? (await getLiteLLMConnection())?.baseUrl;
  if (raw === undefined) throw new LiteLLMError("not_configured");
  const checked = validateLiteLLMBaseUrl(raw, {
    allowedHosts: allowedHostsFromEnv(),
    appEnv: env.APP_ENV,
  });
  if (!checked.ok) throw new LiteLLMError("invalid_base_url");
  const url = `${checked.baseUrl}${request.path}`;

  const maxAttempts = request.method === "GET" ? MAX_GET_ATTEMPTS : 1;
  for (let n = 1; ; n += 1) {
    try {
      return await attempt(url, key, request);
    } catch (error) {
      if (
        !(error instanceof LiteLLMError) ||
        n >= maxAttempts ||
        !retryable(error)
      ) {
        throw error;
      }
      await wait(BACKOFF_MS[n - 1] ?? 500);
    }
  }
}
