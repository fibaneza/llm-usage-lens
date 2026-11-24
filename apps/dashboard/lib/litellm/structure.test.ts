import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { LITELLM_OPERATIONS } from "./allowlist";

// Source: docs/specs/2026-11-10-litellm.md — "Security architecture" items 1,
// 3, 5 and threats LT1 (server-only; key never in the bundle), LT2 (no master
// key variable, parameter or reference); Rule 10.2 (lib/litellm/** is
// server-only; no Client Component imports it); docs/plans/20261109_litellm.md §3
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

// Source: docs/specs/2026-11-10-litellm.md - route table (RS2, D-RS1, T-RS1):
// `/user/update` is allowlisted for `resetUserSpend` only; `/user/delete`
// stays forbidden (LT37: no user delete, LiteLLM users are never removed).
describe("/user/update and /user/delete (RS2, T-RS1)", () => {
  it("/user/update is a route of resetUserSpend and of no other operation", () => {
    const users = Object.entries(LITELLM_OPERATIONS)
      .filter(([, op]) => op.routes.some((r) => r.template === "/user/update"))
      .map(([name]) => name);
    expect(users).toEqual(["resetUserSpend"]);
  });

  it("no operation route is /user/delete", () => {
    const templates = Object.values(LITELLM_OPERATIONS).flatMap((op) =>
      op.routes.map((r) => r.template),
    );
    expect(templates).not.toContain("/user/delete");
  });

  it("no production file outside allowlist.ts and operations.ts names /user/update, and none names /user/delete", () => {
    const files = walk(join(ROOT, "apps/dashboard")).filter(
      (f) => isCode(f) && !isTest(rel(f)),
    );
    const allowed = new Set([
      "apps/dashboard/lib/litellm/allowlist.ts",
      "apps/dashboard/lib/litellm/operations.ts",
    ]);
    const update = files
      .map(rel)
      .filter((p) => !allowed.has(p))
      .filter((p) => /["'`]\/user\/update\b/.test(read(join(ROOT, p))));
    const del = files
      .map(rel)
      .filter((p) => /\/user\/delete\b/.test(read(join(ROOT, p))));
    expect(update).toEqual([]);
    expect(del).toEqual([]);
  });
});

// R3 (review RS2 r1); LT35: the one /user/update write is resetUserSpend's.
describe("only resetUserSpend writes /user/update (R3, LT35)", () => {
  it('operations.ts calls write("/user/update") once, inside resetUserSpend', () => {
    const src = read(join(ROOT, "apps/dashboard/lib/litellm/operations.ts"));
    const calls = [...src.matchAll(/write\(\s*["'`]\/user\/update["'`]/g)];
    expect(calls).toHaveLength(1);
    const start = src.indexOf("export async function resetUserSpend");
    expect(start).toBeGreaterThanOrEqual(0);
    const next = src.indexOf("\nexport ", start + 1);
    const body = src.slice(start, next === -1 ? undefined : next);
    expect(body).toMatch(/write\(\s*["'`]\/user\/update["'`]/);
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

// Source: docs/specs/2026-11-10-litellm.md - the LW1 paragraph after
// `createUser` ("SSO enabled" is answered by one function in `lib/auth/`; the
// operation gate refuses `createUser` through `ssoOffOnly`, next to
// `ossOnly`) and tests T-LW4 / T-LW1; Access Control - "Create and link only
// without SSO"; Rules 10.3, 50.3 (no provider detail in routes or components).
// Scope: `app/**` (routes and pages) and `components/**` never read the
// variable. `lib/api/access-route.ts` (`entraConfigured`, Password users D24:
// all three Entra variables) and `auth.ts` are neither a route nor a
// component and answer a different question, so they are out of scope.
describe("one lib/auth function answers 'SSO enabled' (T-LW4, LW1)", () => {
  const SSO_FN = "apps/dashboard/lib/auth/sso-mode.ts";
  const VAR = "AUTH_MICROSOFT_ENTRA_ID_ID";
  const codeUnder = (dir: string) =>
    walk(join(ROOT, dir)).filter((f) => isCode(f) && !isTest(rel(f)));

  it("the function is exported from lib/auth/sso-mode.ts and reads the variable through env", () => {
    const src = read(join(ROOT, SSO_FN));
    expect(src).toMatch(/export\s+(async\s+)?function\s+isSsoEnabled\b/);
    expect(src).toContain(`env.${VAR}`);
  });

  it("no file under app/** or components/** mentions the variable", () => {
    const offenders = [
      ...codeUnder("apps/dashboard/app"),
      ...codeUnder("apps/dashboard/components"),
    ].filter((f) => read(f).includes(VAR));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("no lib/litellm module reads the variable; the gate calls the one function", () => {
    expect(litellmFiles.filter((f) => read(f).includes(VAR)).map(rel)).toEqual(
      [],
    );
    const src = read(join(litellmDir, "operations.ts"));
    expect(src).toMatch(
      /import\s*\{[^}]*\bisSsoEnabled\b[^}]*\}\s*from\s*["']@\/lib\/auth\/sso-mode["']/,
    );
    expect(src).toMatch(/\bisSsoEnabled\(\)/);
  });

  // LW1 coordinator ruling (2026-11-24): the server gate is the enforcement;
  // enabledOperations() and the toggles view use the same predicate, never a
  // second hand-written copy of the edition / ossOnly / ssoOffOnly clauses.
  it("enabledOperations uses operationUnavailable from operations and holds no clause of its own", () => {
    const src = read(join(litellmDir, "read-views.ts"));
    expect(src).toMatch(
      /import\s*\{[^}]*\boperationUnavailable\b[^}]*\}\s*from\s*["']\.\/operations["']/,
    );
    const body = src.slice(
      src.indexOf("export async function enabledOperations"),
    );
    expect(body).toMatch(/\boperationUnavailable\(/);
    expect(src).not.toMatch(/\.ossOnly\b/);
    expect(src).not.toMatch(/\.ssoOffOnly\b/);
    expect(src).not.toMatch(/enterpriseOnly/);
  });

  it("the toggles view computes ssoEnabled by calling isSsoEnabled(), with no env read", () => {
    const src = read(
      join(ROOT, "apps/dashboard/app/api/litellm/toggles/route.ts"),
    );
    expect(src).toMatch(
      /import\s*\{[^}]*\bisSsoEnabled\b[^}]*\}\s*from\s*["']@\/lib\/auth\/sso-mode["']/,
    );
    expect(src).toMatch(/ssoEnabled\s*:\s*isSsoEnabled\(\)/);
    expect(src).not.toContain(VAR);
  });

  it("isSsoEnabled derives only from the validated env: no request, store or toggle import", () => {
    const src = read(join(ROOT, SSO_FN));
    expect(src).toContain(`env.${VAR}`);
    expect(src.match(/\benv\.[A-Z_0-9]+/g)).toEqual([`env.${VAR}`]);
    const imports = [...src.matchAll(/from\s*["']([^"']+)["']/g)].map(
      (m) => m[1],
    );
    expect(imports).toEqual(["@/env"]);
    expect(src).not.toMatch(/\b(request|headers|cookies|process\.env)\b/);
  });

  it("createUser is the only operation marked ssoOffOnly (next to its ossOnly)", () => {
    const marked = Object.entries(LITELLM_OPERATIONS)
      .filter(([, op]) => "ssoOffOnly" in op && op.ssoOffOnly === true)
      .map(([name]) => name);
    expect(marked).toEqual(["createUser"]);
    expect(LITELLM_OPERATIONS.createUser.ossOnly).toBe(true);
  });
});
