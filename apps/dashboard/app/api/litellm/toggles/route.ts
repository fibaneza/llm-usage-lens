import { randomUUID } from "node:crypto";

import {
  LiteLLMOperationNameSchema,
  liteLLMEdition,
} from "@llm-usage-lens/shared";
import type {
  OperationToggles,
  OperationTogglesView,
} from "@llm-usage-lens/shared";
import { z } from "zod";

import { env } from "@/env";
import {
  jsonData,
  jsonError,
  parseJsonBody,
  withRoute,
} from "@/lib/api/respond";
import {
  getOperationToggles,
  putOperationToggles,
  resetOperationToggles,
} from "@/lib/data/litellm/toggles";
import { loadGatewayConfig } from "@/lib/litellm/gateway-config";
import { resolveOperationSettings } from "@/lib/litellm/operation-settings";
import {
  litellmReadRefusal,
  permitAdminOrOrgAdmin,
  openModeRefusal,
} from "@/lib/litellm/route-guard";

// Source: docs/specs/2026-11-10-litellm.md — "API routes" (GET Admin +
// Auditor, PUT Admin), "Toggles narrow only" (DynamoDB, versioned, audited;
// names outside the allowlist are refused), "Guardrail configuration" (each
// operation's effective value and its source ui | file | spec; "reset to file
// defaults" is Admin, audited and versioned like any toggle write). A toggle
// write is dashboard-only: no LiteLLM call.

export const dynamic = "force-dynamic";

const PutBodySchema = z.union([
  z.strictObject({
    version: z.number().int().min(1).nullable(),
    toggles: z
      .partialRecord(LiteLLMOperationNameSchema, z.boolean())
      .refine((t) => Object.keys(t).length > 0, "No toggles given"),
  }),
  z.strictObject({
    version: z.number().int().min(1),
    reset: z.literal(true),
  }),
]);

function view(saved: OperationToggles | null): OperationTogglesView {
  const file = loadGatewayConfig();
  return {
    version: saved?.version ?? 0,
    edition: liteLLMEdition(env.APP_ENV),
    operations: resolveOperationSettings({
      file,
      saved: saved?.toggles ?? null,
    }),
  };
}

export const GET = withRoute(async (_request, _ctx, session) => {
  const refused = openModeRefusal() ?? (await litellmReadRefusal(session));
  if (refused) return refused;
  return jsonData(view(await getOperationToggles()));
});

// Only a bounded prefix of the body is read, then the stream is cancelled, so a
// refused oversized upload cannot cost memory or bandwidth (Rule 10.3). The
// bound sits under the 256 KiB ceiling to leave room for stream read-ahead.
const PEEK_LIMIT_BYTES = 128 * 1024;

async function peekBody(request: Request): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  let read = 0;
  while (read < PEEK_LIMIT_BYTES) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    const room = PEEK_LIMIT_BYTES - read;
    const part = value.length > room ? value.subarray(0, room) : value;
    text += decoder.decode(part, { stream: true });
    read += part.length;
  }
  // The body is a tee of the request's: its cancellation settles only when the
  // other branch is cancelled too, so it is not awaited, and a failure to
  // cancel changes nothing about the refusal.
  reader.cancel().catch(() => undefined);
  return text;
}

// A non-validating peek at the raw body, only to pick which action a refusal
// records; the body is never parsed with the schema before the 403 (Rule 10.3).
async function deniedRecord(request: Request) {
  let reset = false;
  try {
    const raw: unknown = JSON.parse(await peekBody(request));
    reset =
      typeof raw === "object" &&
      raw !== null &&
      (raw as { reset?: unknown }).reset === true;
  } catch {
    reset = false;
  }
  return {
    action: reset
      ? ("litellm.toggles.reset" as const)
      : ("litellm.toggles.update" as const),
    pattern: "/api/litellm/toggles",
  };
}

export const PUT = withRoute(
  async (request, _ctx, session) => {
    const refused = openModeRefusal();
    if (refused) return refused;
    const input = await parseJsonBody(request, PutBodySchema);
    const ctx = {
      actor: session.user.oid,
      requestId: randomUUID(),
      now: new Date(),
      sequence: { next: 0 },
    };
    const saved =
      "reset" in input
        ? await resetOperationToggles({ version: input.version }, ctx)
        : await putOperationToggles(input, ctx);
    if (!saved.ok) {
      return jsonError(409, "CONFLICT", "The toggles were changed; reload");
    }
    return jsonData(view(saved.value));
  },
  {
    permit: permitAdminOrOrgAdmin,
    denied: deniedRecord,
  },
);
