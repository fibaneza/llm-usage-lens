import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Source: docs/specs/2026-11-10-access-control.md - "LiteLLM user sync" (one
// server-only function, `runLiteLLMUserSync` in `lib/litellm-user-sync/run.ts`,
// "with no `next/*` import in its module graph" so the scheduled job can run it
// outside Next; "the sync never writes to LiteLLM"; "the sync never grants a
// role, a lead or an admin scope, and never creates an identity, a password
// user, a credential or a setup link"), "LiteLLM user links" (one match
// function shared by the route and the sync), "Match keys per sign-in mode"
// (SM1: one definition of the mode); tests T-SY2 (structure part), T-SY11
// (structure part), T-SY12 (the job adds no call), T-SM1 (SM1, no route or
// component reads the Entra variable); LiteLLM spec - Data model additions
// (the lease at lib/data/litellm/user-sync-lock.ts; contract for SYNC2).
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const DASH = join(ROOT, "apps/dashboard");
const SYNC_DIR = join(DASH, "lib/litellm-user-sync");
const RUN = join(SYNC_DIR, "run.ts");

const rel = (f: string) => relative(ROOT, f).split(sep).join("/");
const isTest = (f: string) => /\.(test|spec)\.(ts|tsx)$/.test(f);

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

type Import = { spec: string; names: string[]; typeOnly: boolean };

function importsOf(file: string): Import[] {
  const src = readFileSync(file, "utf8");
  const found: Import[] = [];
  const stat =
    /\b(import|export)\s+(type\s+)?(?:([\w$*\s,{}]*?)\s+from\s+)?["']([^"']+)["']/g;
  for (const m of src.matchAll(stat)) {
    const clause = m[3] ?? "";
    const names = [...clause.matchAll(/([\w$]+)(?:\s+as\s+[\w$]+)?/g)]
      .map((n) => n[1] ?? "")
      .filter((n) => n && n !== "type" && n !== "as");
    found.push({ spec: m[4] ?? "", names, typeOnly: Boolean(m[2]) });
  }
  for (const m of src.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    found.push({ spec: m[1] ?? "", names: [], typeOnly: false });
  }
  return found;
}

function resolveLocal(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(DASH, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null;
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    base,
  ]) {
    if (/\.(ts|tsx)$/.test(candidate) && existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

// The runtime module graph from `entry`: type-only imports vanish at compile
// time and are not edges; tests are never in a graph.
function graphOf(entry: string): {
  files: string[];
  externals: Map<string, string[]>;
} {
  const seen = new Set<string>();
  const externals = new Map<string, string[]>();
  const queue = existsSync(entry) ? [entry] : [];
  while (queue.length > 0) {
    const file = queue.pop();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    for (const imp of importsOf(file)) {
      if (imp.typeOnly) continue;
      const local = resolveLocal(file, imp.spec);
      if (local) {
        if (!isTest(local)) queue.push(local);
      } else {
        externals.set(imp.spec, [
          ...(externals.get(imp.spec) ?? []),
          rel(file),
        ]);
      }
    }
  }
  return { files: [...seen].map(rel).sort(), externals };
}

const syncFiles = walk(SYNC_DIR).filter((f) => !isTest(f));

describe("the module and its contract (SYNC2 builds on these paths)", () => {
  it("run.ts exports runLiteLLMUserSync and starts with server-only", () => {
    expect(existsSync(RUN)).toBe(true);
    const src = readFileSync(RUN, "utf8");
    expect(src).toMatch(/^\s*import\s+["']server-only["'];?/);
    expect(src).toMatch(/export\s+(async\s+)?function\s+runLiteLLMUserSync\b/);
  });

  it("the lease lives in lib/data/litellm/user-sync-lock.ts and run.ts reaches it", () => {
    const lock = join(DASH, "lib/data/litellm/user-sync-lock.ts");
    expect(existsSync(lock)).toBe(true);
    expect(graphOf(RUN).files).toContain(rel(lock));
  });
});

describe("T-SY12 / S6d: no next/* import in the module graph of run.ts", () => {
  const graph = graphOf(RUN);

  it("crawls a real graph", () => {
    expect(graph.files.length).toBeGreaterThan(5);
    expect(graph.files).toContain(rel(RUN));
  });

  it("imports nothing from next, next-auth or the app's auth.ts", () => {
    const offenders = [...graph.externals.entries()]
      .filter(([spec]) => /^(next|next-auth)(\/|$)/.test(spec))
      .map(([spec, from]) => `${spec} <- ${from.join(", ")}`);
    expect(offenders).toEqual([]);
    expect(graph.files).not.toContain("apps/dashboard/auth.ts");
  });
});

describe("T-SY2: the sync grants no privilege and creates no sign-in", () => {
  const FORBIDDEN_NAMES = [
    "grantRole",
    "revokeRole",
    "grantAdminScope",
    "revokeAdminScope",
    "createPasswordUser",
    "disablePasswordUser",
    "enablePasswordUser",
    "updatePasswordUserDisplayName",
    "issueSetupLink",
    "deletePasswordUser",
    "setPasswordSignIn",
    "bindPasswordUserOnEntraSignIn",
  ];

  it("has modules to check", () => {
    expect(syncFiles.map(rel)).toContain(rel(RUN));
  });

  it("imports no role-grant, admin-scope or password-user write", () => {
    const offenders: string[] = [];
    for (const file of syncFiles) {
      for (const imp of importsOf(file)) {
        if (/\/(role-grants|admin-scopes)$/.test(imp.spec)) {
          offenders.push(`${rel(file)}: ${imp.spec}`);
        }
        for (const name of imp.names) {
          if (FORBIDDEN_NAMES.includes(name)) {
            offenders.push(`${rel(file)}: ${name}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("T-SY11 / S16: the sync only reads LiteLLM", () => {
  const READS = ["searchUsers", "getTeam", "getUser"];

  it("imports only searchUsers, getTeam and getUser from the gateway operations", () => {
    const offenders: string[] = [];
    let operationsImports = 0;
    for (const file of syncFiles) {
      for (const imp of importsOf(file)) {
        if (
          /lib\/litellm\/operations$/.test(imp.spec) ||
          imp.spec === "./operations"
        ) {
          if (!imp.typeOnly) operationsImports += 1;
          for (const name of imp.names) {
            if (!READS.includes(name)) offenders.push(`${rel(file)}: ${name}`);
          }
        }
      }
    }
    expect(operationsImports).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });

  it("reaches no other LiteLLM write path (client, gateway, write helpers)", () => {
    const offenders: string[] = [];
    for (const file of syncFiles) {
      for (const imp of importsOf(file)) {
        if (
          /lib\/litellm\/(gateway|member-write|team-write|litellm-id-write)$/.test(
            imp.spec,
          )
        ) {
          offenders.push(`${rel(file)}: ${imp.spec}`);
        }
        if (/lib\/litellm\/client$/.test(imp.spec)) {
          for (const name of imp.names) {
            if (!/Error$/.test(name)) offenders.push(`${rel(file)}: ${name}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the sync's own modules call no write operation by name", () => {
    const WRITES = [
      "createUser",
      "addTeamMember",
      "removeTeamMember",
      "createTeam",
      "resetUserSpend",
      "resetMemberSpend",
      "callAllowlisted",
    ];
    const offenders = syncFiles.filter((f) =>
      WRITES.some((w) =>
        new RegExp(`\\b${w}\\b`).test(readFileSync(f, "utf8")),
      ),
    );
    expect(offenders.map(rel)).toEqual([]);
  });
});

describe("V6 / T-SY1: one match function for the link route and the sync", () => {
  const MATCH = "lib/data/access/litellm-match";
  const ROUTE = join(DASH, "app/api/identities/[oid]/litellm-link/route.ts");

  it("the match function lives in lib/data/access/litellm-match.ts", () => {
    expect(existsSync(join(DASH, `${MATCH}.ts`))).toBe(true);
  });

  it("the sync calls it and the route's match mode calls it", () => {
    const importsMatch = (f: string) =>
      importsOf(f).some(
        (i) =>
          i.spec.endsWith("/litellm-match") &&
          i.names.includes("matchLiteLLMUser"),
      );
    expect(syncFiles.some(importsMatch)).toBe(true);
    expect(importsMatch(ROUTE)).toBe(true);
  });

  it("the route no longer compares the two emails inline", () => {
    expect(readFileSync(ROUTE, "utf8")).not.toMatch(/target\.email\s*!==/);
  });
});

describe("W2 / T-SY1, T-SY6: one key helper for the sync, the match and the sign-in link", () => {
  // Access Control - LiteLLM user links ("one comparison function ... no
  // second comparison") and Match keys per sign-in mode (SM3, SM4): the
  // sign-in link derives its pending keys with the helpers the match uses.
  const MATCH_FILE = join(DASH, "lib/data/access/litellm-match.ts");
  const SIGN_IN = join(DASH, "lib/data/access/sign-in-sync.ts");
  const HELPERS = ["normalizeEmail", "emailKeyOf", "entraIdOf"];

  it("litellm-match.ts exports normalizeEmail, emailKeyOf and entraIdOf", () => {
    const src = readFileSync(MATCH_FILE, "utf8");
    for (const name of HELPERS) {
      expect(src, name).toMatch(
        new RegExp(`export\\s+(?:const|function)\\s+${name}\\b`),
      );
    }
  });

  it("sign-in-sync.ts imports them from ./litellm-match and re-implements no email lower-casing for a pending key", () => {
    const imported = importsOf(SIGN_IN)
      .filter((i) => i.spec === "./litellm-match")
      .flatMap((i) => i.names);
    for (const name of HELPERS) expect(imported, name).toContain(name);
    expect(readFileSync(SIGN_IN, "utf8")).not.toMatch(
      /\.trim\(\)\??\.toLowerCase\(\)/,
    );
  });
});

describe("SM1: one definition of the sign-in mode", () => {
  it("no sync or match module reads the Entra client id variable", () => {
    const files = [
      ...syncFiles,
      join(DASH, "lib/data/access/litellm-match.ts"),
    ].filter((f) => existsSync(f));
    expect(files.length).toBeGreaterThan(1);
    const offenders = files.filter((f) =>
      /AUTH_MICROSOFT_ENTRA_ID_ID/.test(readFileSync(f, "utf8")),
    );
    expect(offenders.map(rel)).toEqual([]);
  });
});
