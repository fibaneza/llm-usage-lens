import "server-only";

import { OperationTogglesSchema } from "@llm-usage-lens/shared";
import type {
  LiteLLMOperationName,
  OperationToggles,
} from "@llm-usage-lens/shared";

import { getTableName } from "@/lib/dynamodb";

import type { AccessResult, AuditContext } from "../access/result";
import { commitAudited, getItem } from "../access/store";

import { LITELLM_CONFIG_PK, LITELLM_TOGGLES_SK } from "./keys";

// Source: docs/specs/2026-11-10-litellm.md — "Data model additions"
// (OperationToggles at LITELLM#CONFIG / TOGGLES, versioned), "Toggles narrow
// only" and "Guardrail configuration" (a saved value wins over the config
// file; "reset to file defaults" clears the saved values, Admin, audited and
// versioned like any toggle write).

export async function getOperationToggles(): Promise<OperationToggles | null> {
  const item = await getItem(LITELLM_CONFIG_PK, LITELLM_TOGGLES_SK);
  if (!item) return null;
  return OperationTogglesSchema.parse({
    version: item.version,
    toggles: item.toggles,
    updatedAt: item.updatedAt,
  });
}

// Audit snapshots hold name lists only ("createTeam=off").
function summary(toggles: Record<string, boolean>): string[] {
  return Object.entries(toggles)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, enabled]) => `${name}=${enabled ? "on" : "off"}`);
}

async function commit(
  action: "litellm.toggles.update" | "litellm.toggles.reset",
  current: OperationToggles | null,
  toggles: Record<string, boolean>,
  ctx: AuditContext,
): Promise<AccessResult<OperationToggles>> {
  const value = OperationTogglesSchema.parse({
    version: (current?.version ?? 0) + 1,
    toggles,
    updatedAt: ctx.now.toISOString(),
  });
  const result = await commitAudited({
    items: [
      {
        Put: {
          TableName: getTableName(),
          Item: { PK: LITELLM_CONFIG_PK, SK: LITELLM_TOGGLES_SK, ...value },
          ...(current
            ? {
                ConditionExpression: "version = :v",
                ExpressionAttributeValues: { ":v": current.version },
              }
            : { ConditionExpression: "attribute_not_exists(PK)" }),
        },
      },
    ],
    audit: {
      action,
      target: { type: "litellm-toggles", id: "default" },
      ...(current
        ? {
            before: {
              version: current.version,
              toggles: summary(current.toggles),
            },
          }
        : {}),
      after: { version: value.version, toggles: summary(value.toggles) },
    },
    ctx,
  });
  return result.ok ? { ok: true, value } : result;
}

// `version: null` creates the item; otherwise it must equal the stored
// version. The new values merge into the saved map.
export async function putOperationToggles(
  input: {
    version: number | null;
    toggles: Partial<Record<LiteLLMOperationName, boolean>>;
  },
  ctx: AuditContext,
): Promise<AccessResult<OperationToggles>> {
  const current = await getOperationToggles();
  if ((current?.version ?? null) !== input.version) {
    return { ok: false, code: "CONFLICT" };
  }
  const merged: Record<string, boolean> = { ...current?.toggles };
  for (const [name, enabled] of Object.entries(input.toggles)) {
    if (typeof enabled === "boolean") merged[name] = enabled;
  }
  return commit("litellm.toggles.update", current, merged, ctx);
}

export async function resetOperationToggles(
  input: { version: number },
  ctx: AuditContext,
): Promise<AccessResult<OperationToggles>> {
  const current = await getOperationToggles();
  if (!current || current.version !== input.version) {
    return { ok: false, code: "CONFLICT" };
  }
  return commit("litellm.toggles.reset", current, {}, ctx);
}
