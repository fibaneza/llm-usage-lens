import { LITELLM_OPERATION_NAMES } from "@llm-usage-lens/shared";
import { describe, expect, it } from "vitest";

import { resolveOperationSettings } from "./operation-settings";

// Source: docs/specs/2026-11-10-litellm.md — "Guardrail configuration"
// (precedence, amended 2026-11-17 by unit CFG, user decision D1: for an
// operation the config file sets, the file wins over a saved OperationToggles
// item; for an operation it does not set, a saved value wins, then LD10; the
// panel shows each operation's effective value and its source
// `ui | file | spec`, `file` meaning locked; reads gain a toggle, default on),
// System Architecture — "Configuration file" (Locked settings; Q1 narrow-only),
// decision LD10 (destructive off: only resetMemberSpend and deleteKey among L2
// operations), implementation-phases CFG Verify ("file only, database only,
// both (file wins), neither (default)").
//
// Contract: resolveOperationSettings({ file, saved }) is pure (same signature;
// the precedence flips for file-set operations).
//   file:  the parsed config { operations: { [op]: { enabled: false } } } | null
//   saved: the stored toggles { [op]: boolean } (OperationToggles.toggles) | null
//   returns Record<operation, { enabled: boolean; source: "ui" | "file" | "spec" }>
//   (an operation the file sets is `file` whatever `saved` holds)
// for every operation in LITELLM_OPERATION_NAMES.
const file = (operations: Record<string, { enabled: false }>) => ({
  operations,
});

describe("resolveOperationSettings", () => {
  it("returns an entry for every operation", () => {
    const r = resolveOperationSettings({ file: null, saved: null });
    expect(Object.keys(r).sort()).toEqual([...LITELLM_OPERATION_NAMES].sort());
  });

  it("with no file and nothing saved, LD10 applies with source 'spec'", () => {
    const r = resolveOperationSettings({ file: null, saved: null });
    expect(r.resetMemberSpend).toEqual({ enabled: false, source: "spec" });
    expect(r.resetUserSpend).toEqual({ enabled: false, source: "spec" });
    expect(r.deleteKey).toEqual({ enabled: false, source: "spec" });
    expect(r.removeTeamMember).toEqual({ enabled: true, source: "spec" });
    expect(r.createTeam).toEqual({ enabled: true, source: "spec" });
  });

  // MG-D11 / MG-D11a: a request alone changes nothing in LiteLLM, so the
  // toggle defaults on; the file can still switch it off (narrow only).
  it("requestBudgetReset defaults on (source 'spec') and the file can switch it off", () => {
    expect(
      resolveOperationSettings({ file: null, saved: null }).requestBudgetReset,
    ).toEqual({ enabled: true, source: "spec" });
    expect(
      resolveOperationSettings({
        file: file({ requestBudgetReset: { enabled: false } }),
        saved: null,
      }).requestBudgetReset,
    ).toEqual({ enabled: false, source: "file" });
  });

  it("reads default on (source 'spec')", () => {
    const r = resolveOperationSettings({ file: null, saved: null });
    for (const name of [
      "getTeam",
      "listProxyTeams",
      "getUser",
      "listKeys",
      "listProxyAuditLog",
      "getGlobalSpendReport",
    ] as const) {
      expect(r[name]).toEqual({ enabled: true, source: "spec" });
    }
  });

  it("an operation listed in the file takes the file value with source 'file'", () => {
    const r = resolveOperationSettings({
      file: file({
        createTeam: { enabled: false },
        getTeam: { enabled: false },
      }),
      saved: null,
    });
    expect(r.createTeam).toEqual({ enabled: false, source: "file" });
    expect(r.getTeam).toEqual({ enabled: false, source: "file" });
  });

  it("an operation missing from the file falls back to LD10 ('spec')", () => {
    const r = resolveOperationSettings({
      file: file({ createTeam: { enabled: false } }),
      saved: null,
    });
    expect(r.deleteKey).toEqual({ enabled: false, source: "spec" });
    expect(r.blockKey).toEqual({ enabled: true, source: "spec" });
  });

  it("the file wins over a saved value for an operation it sets (D1), source 'file'", () => {
    const r = resolveOperationSettings({
      file: file({ createTeam: { enabled: false } }),
      saved: { createTeam: true },
    });
    expect(r.createTeam).toEqual({ enabled: false, source: "file" });
  });

  it("a saved value wins over LD10 for an operation the file does not set, source 'ui'", () => {
    const r = resolveOperationSettings({
      file: file({ createTeam: { enabled: false } }),
      saved: { deleteKey: true, blockKey: false },
    });
    expect(r.deleteKey).toEqual({ enabled: true, source: "ui" });
    expect(r.blockKey).toEqual({ enabled: false, source: "ui" });
  });

  it("removing the key from the file restores the stored value (the item was never changed)", () => {
    const saved = { createTeam: true };
    const locked = resolveOperationSettings({
      file: file({ createTeam: { enabled: false } }),
      saved,
    });
    const unlocked = resolveOperationSettings({ file: file({}), saved });
    expect(locked.createTeam).toEqual({ enabled: false, source: "file" });
    expect(unlocked.createTeam).toEqual({ enabled: true, source: "ui" });
  });

  it("only unlocked operations present in the saved item report 'ui'; the rest keep their file/spec source", () => {
    const r = resolveOperationSettings({
      file: file({ listKeys: { enabled: false } }),
      saved: { getTeam: false },
    });
    expect(r.getTeam.source).toBe("ui");
    expect(r.listKeys).toEqual({ enabled: false, source: "file" });
    expect(r.blockKey.source).toBe("spec");
  });

  it("an empty saved item is the same as none (reset to file defaults)", () => {
    const withEmpty = resolveOperationSettings({
      file: file({ createTeam: { enabled: false } }),
      saved: {},
    });
    const withNull = resolveOperationSettings({
      file: file({ createTeam: { enabled: false } }),
      saved: null,
    });
    expect(withEmpty).toEqual(withNull);
  });

  it("ignores a saved name outside the allowlist: toggles can never add an operation", () => {
    const r = resolveOperationSettings({
      file: null,
      saved: { deleteTeam: true, "/team/delete": true } as never,
    });
    expect(Object.keys(r).sort()).toEqual([...LITELLM_OPERATION_NAMES].sort());
  });
});
