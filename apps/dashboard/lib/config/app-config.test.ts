// @vitest-environment node
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { loadAppConfig, MAX_APP_CONFIG_BYTES } from "./app-config";

// Source: docs/specs/2026-05-15-system-architecture.md — "Configuration file"
// (Loading: read once at first load, validated, frozen, `isFileSet(keyPath)`,
// no hot reload, optional APP_CONFIG_FILE, a missing baked-in file is an empty
// configuration, a missing or unreadable APP_CONFIG_FILE file stops the start;
// Validation: `yaml` package, YAML 1.2 core schema, no custom tags / merge keys
// / anchors / aliases, duplicate keys error, 64 KiB cap checked before parsing,
// the message names the key path and never echoes a value; "The checked-in
// file"; Observability), decisions D2, A2, A4, A5, A8, A9; Access Control T36
// (secret-shaped key), T38 (parser safety: tags, aliases, duplicates, size,
// read once); Rules 50.6, 60.17, 60.19.
//
// Contract for the developer (apps/dashboard/lib/config/app-config.ts,
// `import "server-only"`):
//   loadAppConfig(options?: {
//     path?: string;                                  // APP_CONFIG_FILE; unset = baked-in default
//     readFile?: (path: string) => string | Uint8Array; // default: fs.readFileSync
//   }): LoadedAppConfig
//   type LoadedAppConfig = {
//     config: AppConfig;                  // deep-frozen, validated by AppConfigSchema
//     isFileSet(keyPath: string): boolean; // dot path; leaf or ancestor of a set key
//     fileSetKeyPaths: readonly string[];  // leaf key paths, names only (never values)
//   }
//   - `path` undefined: ENOENT -> empty config {}; any other read error throws.
//   - `path` given: any read error (ENOENT included) throws.
//   MAX_APP_CONFIG_BYTES = 64 * 1024.
//   Module singleton (first import reads APP_CONFIG_FILE from `@/env` once):
//     getAppConfig(): AppConfig; isFileSet(keyPath): boolean;
//     getFileSetKeyPaths(): readonly string[]
const enoent = () =>
  Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });
const eacces = () =>
  Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
const from = (text: string) => ({ readFile: () => text });
const load = (text: string) => loadAppConfig(from(text));

const CHECKED_IN = fileURLToPath(
  new URL("../../config/config.yaml", import.meta.url),
);
const OLD_JSON = fileURLToPath(
  new URL("../../config/litellm-gateway.json", import.meta.url),
);
const FIXTURES = fileURLToPath(
  new URL("../../test/fixtures/config/", import.meta.url),
);

describe("loadAppConfig — files and fallbacks (Loading, A3, A5)", () => {
  it("returns an empty configuration for a missing default file", () => {
    const loaded = loadAppConfig({
      readFile: () => {
        throw enoent();
      },
    });
    expect(loaded.config).toEqual({});
    expect(loaded.fileSetKeyPaths).toEqual([]);
    expect(loaded.isFileSet("display.orgName")).toBe(false);
  });

  it("throws when the file named by APP_CONFIG_FILE is missing", () => {
    expect(() =>
      loadAppConfig({
        path: "/mnt/config/config.yaml",
        readFile: () => {
          throw enoent();
        },
      }),
    ).toThrow();
  });

  it("throws when the default file exists but cannot be read (not a silent fallback, Rule 60.17)", () => {
    expect(() =>
      loadAppConfig({
        readFile: () => {
          throw eacces();
        },
      }),
    ).toThrow();
  });

  it.each([
    ["an empty file", ""],
    ["a comment-only file", "# nothing set\n# display:\n#   orgName: x\n"],
  ])("%s is a valid empty configuration (A5)", (_n, text) => {
    expect(load(text).config).toEqual({});
  });

  it("reads the full fixture and freezes the result (D2: frozen at startup)", () => {
    const loaded = loadAppConfig({
      path: join(FIXTURES, "full.yaml"),
    });
    expect(loaded.config).toEqual({
      litellm: {
        operations: {
          createTeam: { enabled: false },
          resetMemberSpend: { enabled: false },
        },
      },
      display: { defaultDateRange: "7d", orgName: "Acme Corp" },
      data: { retention: { dailyRollupDays: 730 } },
    });
    expect(Object.isFrozen(loaded.config)).toBe(true);
    expect(Object.isFrozen(loaded.config.display)).toBe(true);
    expect(Object.isFrozen(loaded.config.litellm?.operations)).toBe(true);
  });

  it("reads the file once per load (D2)", () => {
    const readFile = vi.fn(() => "display:\n  orgName: Acme\n");
    loadAppConfig({ readFile });
    expect(readFile).toHaveBeenCalledTimes(1);
  });

  it("parses YAML 1.2 core: `yes` is a string, not a boolean (A2)", () => {
    expect(load("display:\n  orgName: yes\n").config.display?.orgName).toBe(
      "yes",
    );
  });
});

describe("loadAppConfig — isFileSet and the file-set key paths (A6, Observability)", () => {
  const loaded = loadAppConfig({
    readFile: () =>
      [
        "litellm:",
        "  operations:",
        "    deleteKey:",
        "      enabled: false",
        "display:",
        "  orgName: Acme",
      ].join("\n"),
  });

  it.each([
    ["litellm.operations.deleteKey.enabled", true],
    ["litellm.operations.deleteKey", true],
    ["display.orgName", true],
    ["display", true],
    ["litellm.operations.createTeam", false],
    ["litellm.operations.createTeam.enabled", false],
    ["display.defaultDateRange", false],
    ["data.retention.dailyRollupDays", false],
  ])("isFileSet(%s) is %s", (path, expected) => {
    expect(loaded.isFileSet(path)).toBe(expected);
  });

  it("lists the leaf key paths that the file sets, names only", () => {
    expect([...loaded.fileSetKeyPaths].sort()).toEqual([
      "display.orgName",
      "litellm.operations.deleteKey.enabled",
    ]);
    expect(JSON.stringify(loaded.fileSetKeyPaths)).not.toContain("Acme");
  });
});

describe("loadAppConfig — invalid files stop the start and never echo a value (A4, T36, T38, Rule 50.6)", () => {
  const messageOf = (text: string): string => {
    try {
      load(text);
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
    throw new Error("expected loadAppConfig to throw");
  };

  it.each([
    [
      "a wrong enum value",
      "display:\n  defaultDateRange: SENTINEL-45d\n",
      "display.defaultDateRange",
      "SENTINEL-45d",
    ],
    [
      "a wrong type",
      "data:\n  retention:\n    dailyRollupDays: 99999\n",
      "data.retention.dailyRollupDays",
      "99999",
    ],
    [
      "an unknown key",
      "display:\n  colour: SENTINEL-blue\n",
      "display.colour",
      "SENTINEL-blue",
    ],
    [
      "a secret-shaped key",
      "display:\n  apiKey: SENTINEL-value\n",
      "display.apiKey",
      "SENTINEL-value",
    ],
    [
      "an authorization key",
      "roles:\n  - SENTINEL-internal-admin\n",
      "roles",
      "SENTINEL-internal-admin",
    ],
    [
      "enabled: true on an operation",
      "litellm:\n  operations:\n    createTeam:\n      enabled: true\n",
      "litellm.operations.createTeam.enabled",
      "true",
    ],
  ])(
    "%s: throws naming the key path, with no value",
    (_n, text, keyPath, value) => {
      const message = messageOf(text);
      expect(message).toContain(keyPath);
      expect(message).not.toContain(value);
    },
  );

  it("a duplicate key throws and does not echo either value", () => {
    const message = messageOf(
      "display:\n  orgName: SENTINEL-one\n  orgName: SENTINEL-two\n",
    );
    expect(message).not.toContain("SENTINEL");
  });

  it.each([
    ["a syntax error", "display: [unclosed\n  orgName: SENTINEL-x\n"],
    ["a non-mapping document", "- SENTINEL-a\n- SENTINEL-b\n"],
    [
      "several documents",
      "display:\n  orgName: a\n---\ndisplay:\n  orgName: SENTINEL-b\n",
    ],
  ])("%s throws without echoing the file's content", (_n, text) => {
    expect(() => load(text)).toThrow();
    expect(messageOf(text)).not.toContain("SENTINEL");
  });
});

describe("loadAppConfig — parser safety (A2, T38)", () => {
  it.each([
    ["a custom tag", "display:\n  orgName: !custom SENTINEL\n"],
    ["a language tag", "display:\n  orgName: !!js/function 'SENTINEL'\n"],
    ["a binary tag", "display:\n  orgName: !!binary SENTINEL\n"],
    ["an anchor and alias", "a: &x Acme\ndisplay:\n  orgName: *x\n"],
    ["a merge key", "base: &b\n  orgName: Acme\ndisplay:\n  <<: *b\n"],
  ])("rejects %s", (_n, text) => {
    expect(() => load(text)).toThrow();
  });

  it("accepts a file of exactly 64 KiB and rejects one byte more, before parsing (T38)", () => {
    expect(MAX_APP_CONFIG_BYTES).toBe(64 * 1024);
    // A comment-only file would parse fine at any size, so only the cap fails it.
    expect(load("#".repeat(MAX_APP_CONFIG_BYTES)).config).toEqual({});
    expect(() => load("#".repeat(MAX_APP_CONFIG_BYTES + 1))).toThrow();
  });

  it("measures the cap in bytes, not characters", () => {
    expect(() => load("é".repeat(MAX_APP_CONFIG_BYTES / 2 + 1))).toThrow();
  });
});

// A8 / A5: the JSON file moved, value for value, under litellm.operations.
describe("the checked-in config/config.yaml (A5, A8)", () => {
  it("exists and the former litellm-gateway.json is gone (no fallback reader)", () => {
    expect(existsSync(CHECKED_IN)).toBe(true);
    expect(existsSync(OLD_JSON)).toBe(false);
  });

  // Rework B1/B2 (review-blockers.md; agent decision A16, System Architecture
  // - Configuration file: the checked-in config.yaml sets no operation;
  // deleteKey and resetMemberSpend appear only as commented examples; LD10
  // stays their default). Supersedes the round-0 "yields the former JSON
  // value" assertion: a file-set operation is locked (D1), so shipping them
  // set would hard-lock what LD10 lets an Admin switch and break A5.
  it("sets no operation: the shipped file locks nothing LD10 lets an Admin switch (A5, A16, B1/B2)", () => {
    const { config, fileSetKeyPaths } = loadAppConfig({ path: CHECKED_IN });
    expect(config.litellm?.operations ?? {}).toEqual({});
    expect(
      fileSetKeyPaths.filter((p) => p.startsWith("litellm.operations")),
    ).toEqual([]);
    expect([...fileSetKeyPaths]).toEqual([]);
  });

  it("keeps the former JSON's two entries as commented examples (A16)", () => {
    const text = readFileSync(CHECKED_IN, "utf8");
    for (const op of ["deleteKey", "resetMemberSpend"]) {
      expect(text).toMatch(new RegExp(`^\\s*#.*${op}`, "m"));
      expect(text).not.toMatch(new RegExp(`^\\s*${op}:`, "m"));
    }
  });

  it("documents each v1 key in a comment", () => {
    const text = readFileSync(CHECKED_IN, "utf8");
    for (const key of ["defaultDateRange", "orgName", "dailyRollupDays"]) {
      expect(text).toMatch(new RegExp(`^\\s*#.*${key}`, "m"));
    }
  });

  it("is far below the 64 KiB cap", () => {
    expect(readFileSync(CHECKED_IN).byteLength).toBeLessThan(
      MAX_APP_CONFIG_BYTES / 4,
    );
  });
});

// D2: loaded once when the server process first loads the module; no hot reload.
describe("the module singleton (D2, A9, T38)", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
    vi.resetModules();
  });

  async function freshModule(env: Record<string, string>) {
    vi.resetModules();
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    return import("./app-config");
  }

  it("reads APP_CONFIG_FILE once; a changed file is not re-read", async () => {
    dir = mkdtempSync(join(tmpdir(), "app-config-"));
    const file = join(dir, "config.yaml");
    writeFileSync(file, "display:\n  orgName: First\n");
    const mod = await freshModule({ APP_CONFIG_FILE: file });
    expect(mod.getAppConfig().display?.orgName).toBe("First");
    expect(mod.isFileSet("display.orgName")).toBe(true);

    writeFileSync(
      file,
      "display:\n  orgName: Second\ndata:\n  retention:\n    dailyRollupDays: 90\n",
    );
    expect(mod.getAppConfig().display?.orgName).toBe("First");
    expect(mod.isFileSet("data.retention.dailyRollupDays")).toBe(false);
    expect(mod.getFileSetKeyPaths()).toEqual(["display.orgName"]);
  });

  it("with APP_CONFIG_FILE set to a missing file, loading the module throws", async () => {
    dir = mkdtempSync(join(tmpdir(), "app-config-"));
    await expect(
      freshModule({ APP_CONFIG_FILE: join(dir, "missing.yaml") }),
    ).rejects.toThrow();
  });

  it("with APP_CONFIG_FILE set to an invalid fixture, loading the module throws", async () => {
    dir = mkdtempSync(join(tmpdir(), "app-config-"));
    const file = join(dir, "bad.yaml");
    writeFileSync(file, "colour: blue\n");
    await expect(freshModule({ APP_CONFIG_FILE: file })).rejects.toThrow();
  });

  it("with no APP_CONFIG_FILE, the baked-in config/config.yaml is used", async () => {
    vi.stubEnv("APP_CONFIG_FILE", undefined);
    vi.resetModules();
    const mod = await import("./app-config");
    expect(mod.getAppConfig().litellm?.operations ?? {}).toEqual({});
  });
});
