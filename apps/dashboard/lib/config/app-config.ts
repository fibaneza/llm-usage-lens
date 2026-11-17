import "server-only";

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { trace } from "@opentelemetry/api";
import { AppConfigSchema } from "@llm-usage-lens/shared";
import type { AppConfig } from "@llm-usage-lens/shared";
import { isNode, parseAllDocuments, visit } from "yaml";
import type { z } from "zod";

import { env } from "@/env";

// Source: docs/specs/2026-05-15-system-architecture.md — "Configuration file"
// (Loading: read once, validated, frozen, `isFileSet`; Validation: `yaml` in
// YAML 1.2 core schema, no custom tags, merge keys, anchors or aliases, a
// duplicate key is an error, 64 KiB cap before parsing; Observability); A2, A4,
// A13; Access Control T36, T38; Rules 50.6, 60.17, 60.19. An error names the
// key path and never a value, a snippet or a line of the file.

export const MAX_APP_CONFIG_BYTES = 64 * 1024;

const DEFAULT_CONFIG_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../config/config.yaml",
);

export type LoadedAppConfig = {
  config: AppConfig;
  isFileSet(keyPath: string): boolean;
  fileSetKeyPaths: readonly string[];
};

type ReadFile = (path: string) => string | Uint8Array;

function invalid(reason: string): Error {
  return new Error(`Invalid configuration file: ${reason}`);
}

function readText(
  path: string,
  readFile: ReadFile,
  mayBeMissing: boolean,
): string | undefined {
  let raw: string | Uint8Array;
  try {
    raw = readFile(path);
  } catch (error) {
    if (
      mayBeMissing &&
      (error as { code?: unknown } | null)?.code === "ENOENT"
    ) {
      return undefined;
    }
    throw error;
  }
  const bytes =
    typeof raw === "string" ? Buffer.byteLength(raw, "utf8") : raw.byteLength;
  if (bytes > MAX_APP_CONFIG_BYTES) {
    throw invalid(`larger than ${MAX_APP_CONFIG_BYTES} bytes`);
  }
  return typeof raw === "string" ? raw : new TextDecoder().decode(raw);
}

function parseYaml(text: string): unknown {
  const documents = parseAllDocuments(text, {
    version: "1.2",
    schema: "core",
    uniqueKeys: true,
    merge: false,
    prettyErrors: false,
  });
  if (documents.length > 1) throw invalid("more than one YAML document");
  const doc = documents[0];
  if (!doc) return undefined;
  // Unknown tags only warn in `yaml`; here they are errors.
  if (doc.errors.length > 0 || doc.warnings.length > 0) {
    throw invalid("not valid YAML (syntax, duplicate key or custom tag)");
  }
  let usesAnchor = false;
  visit(doc, {
    Alias() {
      usesAnchor = true;
    },
    Node(_key, node) {
      if (isNode(node) && "anchor" in node && node.anchor) usesAnchor = true;
    },
  });
  if (usesAnchor) throw invalid("anchors, aliases and merge keys are refused");
  return doc.toJS();
}

function failingKeyPaths(issues: readonly z.core.$ZodIssue[]): string[] {
  const paths = issues.flatMap((issue) => {
    const base = issue.path.map(String);
    if (issue.code === "unrecognized_keys" && issue.keys.length > 0) {
      return issue.keys.map((key) => [...base, key].join("."));
    }
    return [base.length > 0 ? base.join(".") : "(document)"];
  });
  return [...new Set(paths)];
}

function leafKeyPaths(value: unknown, prefix: string): string[] {
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, child]) =>
      leafKeyPaths(child, prefix === "" ? key : `${prefix}.${key}`),
    );
  }
  return prefix === "" ? [] : [prefix];
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export function loadAppConfig(
  options: { path?: string; readFile?: ReadFile } = {},
): LoadedAppConfig {
  // A missing baked-in file is an empty configuration; a file named on
  // purpose must exist.
  const text = readText(
    options.path ?? DEFAULT_CONFIG_PATH,
    options.readFile ?? readFileSync,
    options.path === undefined,
  );
  const parsed = text === undefined ? undefined : parseYaml(text);
  const result = AppConfigSchema.safeParse(parsed ?? {});
  if (!result.success) {
    throw invalid(
      `invalid key or value at ${failingKeyPaths(result.error.issues).join(", ")}`,
    );
  }
  const config = deepFreeze(result.data);
  const fileSetKeyPaths = Object.freeze(leafKeyPaths(config, ""));
  return {
    config,
    fileSetKeyPaths,
    isFileSet: (keyPath) =>
      fileSetKeyPaths.some(
        (leaf) => leaf === keyPath || leaf.startsWith(`${keyPath}.`),
      ),
  };
}

// Read once, when the server process first loads this module (D2: no hot
// reload). An empty variable counts as unset (A13). A bad file stops the start.
const loaded = loadAppConfig({ path: env.APP_CONFIG_FILE || undefined });

// Called once from instrumentation.ts at server start: the key paths that the
// file sets, names only, never values (System Architecture — Configuration
// file, Observability; Rule 50.6).
export function reportConfigLoaded(): void {
  trace
    .getTracer("llm-usage-lens-config")
    .startSpan("config.loaded", {
      attributes: { "config.file_set_key_paths": [...loaded.fileSetKeyPaths] },
    })
    .end();
}

export function getAppConfig(): AppConfig {
  return loaded.config;
}

export function isFileSet(keyPath: string): boolean {
  return loaded.isFileSet(keyPath);
}

export function getFileSetKeyPaths(): readonly string[] {
  return loaded.fileSetKeyPaths;
}
