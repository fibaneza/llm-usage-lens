import { LITELLM_OPERATION_NAMES } from "@llm-usage-lens/shared";
import { describe, expect, it } from "vitest";

import { resolveOperationSettings } from "./operation-settings";

// Source: docs/specs/2026-11-10-litellm.md — "Guardrail configuration"
// (precedence: a saved OperationToggles item (UI) wins over the config file;
// with no item the file applies; with no file entry LD10 applies; the panel
// shows each operation's effective value and its source `ui | file | spec`;
// reads gain a toggle, default on), decision LD10 (destructive off: only
// resetMemberSpend and deleteKey among L2 operations), implementation-phases
// L2 Verify ("precedence UI > file > LD10").
//
// Contract: resolveOperationSettings({ file, saved }) is pure.
//   file:  the parsed config { operations: { [op]: { enabled } }, wildcardWarning } | null
//   saved: the stored toggles { [op]: boolean } (OperationToggles.toggles) | null
//   returns Record<operation, { enabled: boolean; source: "ui" | "file" | "spec" }>
// for every operation in LITELLM_OPERATION_NAMES.
const file = (operations: Record<string, { enabled: boolean }>) => ({
  operations,
  wildcardWarning: true,
});

describe("resolveOperationSettings", () => {
  it("returns an entry for every operation", () => {
    const r = resolveOperationSettings({ file: null, saved: null });
    expect(Object.keys(r).sort()).toEqual([...LITELLM_OPERATION_NAMES].sort());
  });

  it("with no file and nothing saved, LD10 applies with source 'spec'", () => {
    const r = resolveOperationSettings({ file: null, saved: null });
    expect(r.resetMemberSpend).toEqual({ enabled: false, source: "spec" });
    expect(r.deleteKey).toEqual({ enabled: false, source: "spec" });
    expect(r.removeTeamMember).toEqual({ enabled: true, source: "spec" });
    expect(r.createTeam).toEqual({ enabled: true, source: "spec" });
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
        resetMemberSpend: { enabled: true },
      }),
      saved: null,
    });
    expect(r.createTeam).toEqual({ enabled: false, source: "file" });
    expect(r.resetMemberSpend).toEqual({ enabled: true, source: "file" });
  });

  it("an operation missing from the file falls back to LD10 ('spec')", () => {
    const r = resolveOperationSettings({
      file: file({ createTeam: { enabled: false } }),
      saved: null,
    });
    expect(r.deleteKey).toEqual({ enabled: false, source: "spec" });
    expect(r.blockKey).toEqual({ enabled: true, source: "spec" });
  });

  it("a saved value wins over the file in both directions, source 'ui'", () => {
    const r = resolveOperationSettings({
      file: file({
        createTeam: { enabled: false },
        deleteKey: { enabled: true },
      }),
      saved: { createTeam: true, deleteKey: false },
    });
    expect(r.createTeam).toEqual({ enabled: true, source: "ui" });
    expect(r.deleteKey).toEqual({ enabled: false, source: "ui" });
  });

  it("a saved value wins over LD10 when there is no file entry", () => {
    const r = resolveOperationSettings({
      file: null,
      saved: { resetMemberSpend: true, getTeam: false },
    });
    expect(r.resetMemberSpend).toEqual({ enabled: true, source: "ui" });
    expect(r.getTeam).toEqual({ enabled: false, source: "ui" });
  });

  it("only operations present in the saved item report 'ui'; the rest keep their file/spec source", () => {
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
