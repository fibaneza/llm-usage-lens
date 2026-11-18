import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { LITELLM_OPERATIONS } from "./allowlist";

// Source: docs/specs/2026-11-10-litellm.md — "Security architecture" items 1,
// 3, 5 and threats LT1 (server-only; key never in the bundle), LT2 (no master
// key variable, parameter or reference); Rule 10.2 (lib/litellm/** is
// server-only; no Client Component imports it); docs/plans/litellm.md §3
// (no SSM client import under apps/).
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const SKIP = new Set([
  "node_modules",
  ".next",
  "cdk.out",
  "dist",
  ".git",
  "temp",
  "worktrees",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const rel = (f: string) => relative(ROOT, f).split(sep).join("/");
const read = (f: string) => readFileSync(f, "utf8");
const isCode = (f: string) => /\.(ts|tsx)$/.test(f);
const isTest = (f: string) =>
  /\.(test|spec)\.(ts|tsx)$/.test(f) || /\/test\//.test(f);

const litellmDir = join(ROOT, "apps/dashboard/lib/litellm");
const litellmFiles = existsSync(litellmDir)
  ? walk(litellmDir).filter((f) => isCode(f) && !isTest(rel(f)))
  : [];

describe("lib/litellm is server-only", () => {
  it("contains production modules (client.ts at least)", () => {
    expect(litellmFiles.map(rel)).toContain(
      "apps/dashboard/lib/litellm/client.ts",
    );
  });

  it('every production file starts with import "server-only"', () => {
    const offenders = litellmFiles.filter(
      (f) => !/^\s*import\s+["']server-only["'];?/.test(read(f)),
    );
    expect(offenders.map(rel)).toEqual([]);
  });

  it('no "use client" module imports lib/litellm, lib/data/litellm or env.ts secrets', () => {
    const files = walk(join(ROOT, "apps/dashboard")).filter(
      (f) => isCode(f) && !isTest(rel(f)),
    );
    const offenders = files.filter((f) => {
      const src = read(f);
      return (
        /^\s*["']use client["']/m.test(
          src.split("\n").slice(0, 3).join("\n"),
        ) &&
        /["']@\/lib\/(litellm|data\/litellm)\b|\.\.?\/.*\blitellm\//.test(src)
      );
    });
    expect(offenders.map(rel)).toEqual([]);
  });
});

describe("no master key anywhere (LT2)", () => {
  const roots = ["apps", "infra", ".github", "packages", "scripts"]
    .map((d) => join(ROOT, d))
    .filter(existsSync);
  const files = roots
    .flatMap((r) => walk(r))
    .filter(
      (f) =>
        /\.(ts|tsx|json|ya?ml|sh|cjs|mjs|example|md)$/.test(f) ||
        f.endsWith(".env.example"),
    )
    .filter((f) => !isTest(rel(f)) && !rel(f).includes("pnpm-lock"));

  it("scans a non-trivial set of files", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("no master-key variable, parameter or CDK reference in apps/, infra/, packages/, scripts/ or workflows", () => {
    const offenders = files.filter((f) =>
      /LITELLM_MASTER|litellm[-_/ ]?master|master[-_ ]key[-_ ]?param/i.test(
        read(f),
      ),
    );
    expect(offenders.map(rel)).toEqual([]);
  });

  it("no SSM or KMS client import under apps/ (the key is injected by ECS, never fetched)", () => {
    const offenders = walk(join(ROOT, "apps"))
      .filter((f) => isCode(f))
      .filter((f) => rel(f) !== "apps/dashboard/lib/data/secret-envelope.ts")
      .filter((f) => /@aws-sdk\/client-(ssm|kms)\b/.test(read(f)));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("no code path writes the SSM parameter (no PutParameter anywhere in apps/, infra/lib, scripts/)", () => {
    const offenders = [
      ...walk(join(ROOT, "apps")),
      ...walk(join(ROOT, "infra/lib")),
      ...walk(join(ROOT, "scripts")),
    ]
      .filter((f) => isCode(f) && !isTest(rel(f)))
      .filter((f) => /PutParameter/.test(read(f)));
    expect(offenders.map(rel)).toEqual([]);
  });
});

describe("the service key is read only inside lib/litellm and env.ts (LT1, Rule 50.6)", () => {
  it("no other production file references LITELLM_SERVICE_KEY", () => {
    // e2e specs, playwright.config.ts and the L5 probe (apps/dashboard/probe/,
    // LD28) are test tooling: they only inject a fixed, public fake key. The
    // next test keeps the probe from ever reading the real one.
    const isE2eTooling = (p: string) =>
      p.startsWith("apps/dashboard/e2e/") ||
      p.startsWith("apps/dashboard/probe/") ||
      p === "apps/dashboard/playwright.config.ts";
    const files = walk(join(ROOT, "apps/dashboard")).filter(
      (f) => isCode(f) && !isTest(rel(f)) && !isE2eTooling(rel(f)),
    );
    const allowed = (p: string) =>
      p === "apps/dashboard/env.ts" ||
      p.startsWith("apps/dashboard/lib/litellm/") ||
      p.startsWith("apps/dashboard/app/api/litellm/");
    const offenders = files
      .map(rel)
      .filter((p) => !allowed(p))
      .filter((p) => read(join(ROOT, p)).includes("LITELLM_SERVICE_KEY"));
    expect(offenders).toEqual([]);
  });

  // LT1, Rule 50.6, LD18, LD28: non-test probe/ files never name the real key.
  // The one allowed text is the config's fake injection into the app under
  // test. FAKE_LITELLM_SERVICE_KEY and PROBE_FAKE_SERVICE_KEY are the fake's own
  // constant names, not occurrences. Anything else naming LITELLM_SERVICE_KEY
  // (also a split literal such as "LITELLM_" + "SERVICE_KEY") is an offender,
  // as is any computed or aliased read of process.env.
  const ALLOWED_PROBE_ENTRY =
    /\bLITELLM_SERVICE_KEY:\s*FAKE_LITELLM_SERVICE_KEY\b/g;
  const PROBE_CONFIG = "apps/dashboard/probe/playwright.probe.config.ts";
  const probeKeyOffences = (file: string, text: string): string[] => {
    const offences: string[] = [];
    const entries = text.match(ALLOWED_PROBE_ENTRY)?.length ?? 0;
    if (file !== PROBE_CONFIG && entries > 0)
      offences.push("entry outside config");
    if (file === PROBE_CONFIG && entries > 1)
      offences.push("entry more than once");
    const rest = text
      .replace(ALLOWED_PROBE_ENTRY, "")
      .replace(/\bFAKE_LITELLM_SERVICE_KEY\b/g, "")
      .replace(/\bPROBE_FAKE_SERVICE_KEY\b/g, "");
    if (/LITELLM_SERVICE_KEY|LITELLM_["'`]|["'`]SERVICE_KEY/.test(rest))
      offences.push("names the service key");
    if (/process\.env\s*\??\.?\s*\[/.test(text))
      offences.push("computed process.env key");
    if (/\}\s*=\s*process\.env\b/.test(text))
      offences.push("destructures process.env");
    if (/\b(?:const|let|var)\s+\w+\s*=\s*process\.env\b(?!\s*[.[])/.test(text))
      offences.push("aliases process.env");
    if (/\.\.\.\s*process\.env\b/.test(text))
      offences.push("spreads process.env");
    return offences;
  };

  it("the probe key matcher flags reads, destructuring, aliases and a second config entry (LT1, Rule 50.6)", () => {
    const other = "apps/dashboard/probe/other.ts";
    const entry = "env: { LITELLM_SERVICE_KEY: FAKE_LITELLM_SERVICE_KEY },";
    for (const bad of [
      "const { LITELLM_SERVICE_KEY } = process.env;",
      "const { LITELLM_SERVICE_KEY: k } = process.env;",
      "const k = process.env.LITELLM_SERVICE_KEY;",
      'const k = process.env["LITELLM_SERVICE_KEY"];',
      'const k = process.env["LITELLM_" + "SERVICE_KEY"];',
      "const k = process.env[name];",
      "const { A } = process.env;",
      "const e = process.env;",
      "const e = { ...process.env };",
    ]) {
      expect(probeKeyOffences(PROBE_CONFIG, bad), bad).not.toEqual([]);
    }
    expect(probeKeyOffences(PROBE_CONFIG, entry)).toEqual([]);
    expect(probeKeyOffences(PROBE_CONFIG, `${entry}\n${entry}`)).not.toEqual(
      [],
    );
    expect(probeKeyOffences(other, entry)).not.toEqual([]);
    expect(
      probeKeyOffences(
        other,
        'import { FAKE_LITELLM_SERVICE_KEY } from "./c";\nconst { mode } = assertProbeAllowed(process.env);\nprocess.env.LITELLM_PROBE_TEAM ??= "x";\nconst k = process.env.PROBE_FAKE_SERVICE_KEY;',
      ),
    ).toEqual([]);
  });

  it("no non-test file under probe/ names LITELLM_SERVICE_KEY beyond the one fake injection in the config (LT1, LD18, LD28, Rule 50.6)", () => {
    const files = walk(join(ROOT, "apps/dashboard/probe")).filter(
      (f) => isCode(f) && !isTest(rel(f)),
    );
    const offenders = files.flatMap((f) =>
      probeKeyOffences(rel(f), read(f)).map((o) => `${rel(f)}: ${o}`),
    );
    expect(offenders).toEqual([]);
    const config = files.find((f) => rel(f) === PROBE_CONFIG);
    expect(config && read(config).match(ALLOWED_PROBE_ENTRY)?.length).toBe(1);
  });

  it("no source under app/ or components/ interpolates the key into a string sent to the browser", () => {
    const files = walk(join(ROOT, "apps/dashboard")).filter(
      (f) => isCode(f) && !isTest(rel(f)),
    );
    const offenders = files.filter((f) => /NEXT_PUBLIC_LITELLM/.test(read(f)));
    expect(offenders.map(rel)).toEqual([]);
  });
});

// Source: docs/specs/2026-11-10-litellm.md - MG-D11a (`requestBudgetReset` is a
// route-less dashboard operation, default on, in both lists; no LiteLLM call
// exists for it) and MG-D8 (the BudgetReset ledger is append-only: written
// only through `budgetResetPutItem`, never updated or deleted except by TTL).
describe("the route-less requestBudgetReset operation (MG-D11a)", () => {
  it("is the only operation without a LiteLLM route, a default-on write, and has no gateway function", async () => {
    const { LITELLM_OPERATIONS } = await import("./allowlist");
    const { LITELLM_OPERATION_NAMES } = await import("@llm-usage-lens/shared");
    const routeless = LITELLM_OPERATION_NAMES.filter(
      (n) => LITELLM_OPERATIONS[n].routes.length === 0,
    );
    expect(routeless).toEqual(["requestBudgetReset"]);
    expect(LITELLM_OPERATIONS.requestBudgetReset).toMatchObject({
      kind: "write",
      defaultEnabled: true,
    });
    expect(read(join(litellmDir, "operations.ts"))).not.toMatch(
      /\brequestBudgetReset\b/,
    );
  });
});

describe("the BudgetReset ledger is append-only (MG-D8)", () => {
  const dataDir = join(ROOT, "apps/dashboard/lib/data");
  const ledgerModules = [
    "budget-resets.ts",
    "budget-resets-record.ts",
    "budget-reset-counts.ts",
    "budget-resets-keys.ts",
  ];

  it("no ledger module issues an Update or Delete (only TTL removes an item)", () => {
    for (const name of ledgerModules) {
      expect(read(join(dataDir, name)), name).not.toMatch(
        /\b(UpdateCommand|DeleteCommand|UpdateItem|DeleteItem)\b/,
      );
    }
  });

  it("only the ledger modules build BRESET keys, and no route or component writes the ledger directly", () => {
    const files = walk(join(ROOT, "apps/dashboard"))
      .filter((f) => isCode(f) && !isTest(rel(f)))
      .map(rel);
    const keyUsers = files.filter((p) =>
      /\b(bResetPk|bResetSk|bResetsGsi1pk)\b|BRESET#/.test(read(join(ROOT, p))),
    );
    expect(keyUsers.sort()).toEqual(
      ["budget-reset-counts.ts", "budget-resets-keys.ts", "budget-resets.ts"]
        .map((m) => `apps/dashboard/lib/data/${m}`)
        .sort(),
    );
    const writers = files.filter(
      (p) =>
        /^apps\/dashboard\/(app|components)\//.test(p) &&
        /\b(budgetResetPutItem|recordMemberReset)\b/.test(read(join(ROOT, p))),
    );
    expect(writers).toEqual([]);
  });
});

// Source: docs/specs/2026-11-10-litellm.md - Writes table row `createUser`
// (management improvements D16, M3) and the paragraph after it; threat LT-MI1.
// The code row must not drift from the spec row: OSS only, Admin and org-admin,
// toggle on, the fixed body, a findUserByEmail miss first.
describe("createUser is pinned to its spec row (LT-MI1, M3 Verify)", () => {
  const spec = read(join(ROOT, "docs/specs/2026-11-10-litellm.md"));
  const row =
    spec.split("\n").find((l) => l.startsWith("| `createUser`")) ?? "";

  it("the spec row is present and says OSS only, Admin and org-admin, toggle on", () => {
    expect(row).not.toBe("");
    const cells = row.split("|").map((c) => c.trim());
    expect(cells[2]).toContain("POST /user/new");
    expect(cells[2]).toContain("OSS only");
    expect(cells[4]).toBe(
      "Admin, org-admin; only for an app identity with no LiteLLM user for that email (a `findUserByEmail` miss first)",
    );
    expect(cells[5]).toBe("on");
  });

  it("the spec row fixes the body: user_id = user_email = lower-cased verified email, internal_user, auto_create_key false, no invite", () => {
    expect(row).toContain("`user_id`=`user_email`=");
    expect(row).toContain('`user_role:"internal_user"`');
    expect(row).toContain("`auto_create_key:false`");
    expect(row).toContain("`send_invite_email:false`");
  });

  it("the spec refuses createUser on Enterprise with 403 OPERATION_UNAVAILABLE and no call", () => {
    expect(spec).toMatch(
      /Edition gate\s+first: on Enterprise it returns `403 OPERATION_UNAVAILABLE` with no call/,
    );
  });

  it("the code row is a write, default on, with exactly the lookup and the create routes", () => {
    const op = LITELLM_OPERATIONS.createUser;
    expect(op.kind).toBe("write");
    expect(op.defaultEnabled).toBe(true);
    expect(op.routes.map((r) => `${r.method} ${r.template}`).sort()).toEqual([
      "GET /user/list",
      "POST /user/new",
    ]);
    // OSS-only is enforced by the edition check in operations.ts (tested in
    // operation-gates.integration.test.ts), never by an enterpriseOnly route:
    // that flag would refuse the lookup the OSS path needs.
    expect(
      op.routes.some((r) => "enterpriseOnly" in r && r.enterpriseOnly),
    ).toBe(false);
  });

  it("only POST /api/litellm/users calls createUser (no other route or module creates a LiteLLM user)", () => {
    const files = walk(join(ROOT, "apps/dashboard")).filter(
      (f) => isCode(f) && !isTest(rel(f)),
    );
    const callers = files
      .map(rel)
      .filter((p) =>
        /import\s*\{[^}]*\bcreateUser\b[^}]*\}\s*from\s*["'][^"']*operations["']/.test(
          read(join(ROOT, p)),
        ),
      );
    expect(callers).toEqual(["apps/dashboard/app/api/litellm/users/route.ts"]);
  });
});
