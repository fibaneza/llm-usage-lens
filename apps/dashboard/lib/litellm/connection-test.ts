import "server-only";

import type { ConnectionTestResult } from "@llm-usage-lens/shared";

import { getLiteLLMConnection } from "@/lib/data/litellm/connection";

import { LiteLLMError, callLiteLLM, isServiceKeyConfigured } from "./client";
import type { LiteLLMRequest } from "./client";

// Source: docs/specs/2026-11-10-litellm.md — "Security architecture" item 6
// and decision LD4: a read, then the three templated write routes with
// non-existent ids. An allowed route answers 404 or 4xx for the dummy id; 403
// means the service key's allowed_routes is out of date. Stops after a 401.
// Messages are fixed text: upstream text never reaches the caller (LT12).

const NIL_ID = "00000000-0000-0000-0000-000000000000";

const PROBES: LiteLLMRequest[] = [
  { method: "GET", path: "/team/list" },
  {
    method: "POST",
    path: `/team/${NIL_ID}/member/${NIL_ID}/reset_spend`,
    body: {},
  },
  {
    method: "POST",
    path: `/team/${NIL_ID}/member/${NIL_ID}/reset_budget`,
    body: {},
  },
  { method: "POST", path: `/key/${NIL_ID}/regenerate`, body: {} },
];

const result = (
  r: ConnectionTestResult["result"],
  message: string,
): ConnectionTestResult => ({ result: r, message });

export async function testLiteLLMConnection(
  candidateBaseUrl?: string,
): Promise<ConnectionTestResult> {
  if (!isServiceKeyConfigured()) {
    return result("not_configured", "The LiteLLM service key is not set.");
  }
  const baseUrl = candidateBaseUrl ?? (await getLiteLLMConnection())?.baseUrl;
  if (baseUrl === undefined) {
    return result("not_configured", "No LiteLLM base URL is saved.");
  }
  for (const probe of PROBES) {
    try {
      await callLiteLLM(probe, { baseUrl });
    } catch (error) {
      if (!(error instanceof LiteLLMError)) throw error;
      switch (error.detail) {
        case "unauthorised":
          return result(
            "unauthorised",
            "LiteLLM rejected the service key. Rotate and redeploy the service key.",
          );
        case "routes_out_of_date":
          return result(
            "routes_out_of_date",
            "The service key's allowed routes are out of date. Update allowed_routes on the LiteLLM service user.",
          );
        case "not_configured":
        case "invalid_base_url":
          return result(
            "not_configured",
            "The base URL is not permitted by LITELLM_ALLOWED_HOSTS.",
          );
        case "upstream_error":
          // A 4xx from a templated route with a dummy id means the route is
          // allowed; the read must succeed, and a 5xx is never healthy.
          if (
            probe.method === "POST" &&
            (error.status ?? 500) >= 400 &&
            (error.status ?? 500) < 500
          ) {
            continue;
          }
          return result("unreachable", "LiteLLM returned an error.");
        default:
          return result("unreachable", "LiteLLM could not be reached.");
      }
    }
  }
  return result("ok", "LiteLLM accepted the service key and all routes.");
}
