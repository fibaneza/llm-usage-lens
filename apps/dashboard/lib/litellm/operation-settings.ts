import "server-only";

import { LITELLM_OPERATION_NAMES } from "@llm-usage-lens/shared";
import type { LiteLLMOperationName } from "@llm-usage-lens/shared";

import { LITELLM_OPERATIONS } from "./allowlist";

// Source: docs/specs/2026-11-10-litellm.md — "Guardrail configuration"
// (precedence, amended 2026-11-17 by unit CFG, decision D1: an operation the
// config file sets takes the file's value and is locked, whatever is saved;
// otherwise a saved OperationToggles value (UI) wins, then LD10), decision
// LD10. Pure: a name outside the allowlist is ignored, so configuration can
// never add an operation.

export type OperationSource = "ui" | "file" | "spec";
export type OperationSetting = { enabled: boolean; source: OperationSource };

export function resolveOperationSettings(input: {
  file: {
    operations: Partial<Record<string, { enabled: boolean }>>;
  } | null;
  saved: Record<string, boolean> | null;
}): Record<LiteLLMOperationName, OperationSetting> {
  const { file, saved } = input;
  const entries = LITELLM_OPERATION_NAMES.map((name) => {
    const fromFile =
      file && Object.hasOwn(file.operations, name)
        ? file.operations[name]
        : undefined;
    if (fromFile) {
      return [name, { enabled: fromFile.enabled, source: "file" }] as const;
    }
    const fromUi =
      saved && Object.hasOwn(saved, name) ? saved[name] : undefined;
    if (typeof fromUi === "boolean") {
      return [name, { enabled: fromUi, source: "ui" }] as const;
    }
    return [
      name,
      { enabled: LITELLM_OPERATIONS[name].defaultEnabled, source: "spec" },
    ] as const;
  });
  return Object.fromEntries(entries) as Record<
    LiteLLMOperationName,
    OperationSetting
  >;
}
