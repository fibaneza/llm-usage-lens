// Source: docs/specs/2026-11-10-platform.md - "Task role policy (least
// privilege)" (Writes, Audit and Budget-reset ledger rows) and the 2026-11-18
// TRK1 amendment: the writes list had fallen behind the app, and DynamoDB
// Local does not enforce IAM, so only a structure test can see it.
//
// WHEN THIS FAILS: lib/data builds a partition key that no task-role write
// statement covers. Update infra/lib/dashboard-service/task.ts (the write
// LeadingKeys) AND the Platform spec's Task role policy row together, or add
// the prefix to READ_ONLY below with its reason.
//
// The second describe (TRK1 review round 1, coordinator ruling R1) guards the
// ACTIONS: every DynamoDB *Command the app sends must be granted by the task
// role. WHEN IT FAILS: update infra/lib/dashboard-service/task.ts and the
// Platform spec's Task role policy row together (or extend COMMAND_ACTIONS
// below deliberately for a new Command).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { actionsOf, synthApp } from "./support";
import type { Mode } from "./support";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- CFN template JSON is untyped

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const DATA = join(REPO, "apps/dashboard/lib/data");

// Key modules parsed for *Pk / *_PK builders. A new `*keys*.ts` under
// lib/data fails the test until it is added here (so it is parsed too).
const KEY_MODULES = [
  "packages/shared/src/table.ts",
  "apps/dashboard/lib/data/access/keys.ts",
  "apps/dashboard/lib/data/litellm/keys.ts",
  "apps/dashboard/lib/data/budget-resets-keys.ts",
  "apps/dashboard/lib/data/notifications-keys.ts",
];

// Partition-key prefixes the dashboard never writes (Data Model spec - Entity
// Map). Each needs a reason; anything else must be a write pattern.
const READ_ONLY: Record<string, string> = {
  SYSTEM:
    "SyncStatus, written by the collector; the task role must never write it (Platform - Writes row)",
  "DATE#":
    "GSI partition value (gsi1pk), not a table partition key; the dashboard never writes it",
  "DEPT#":
    "GSI partition value (gsi1pk), not a table partition key; the dashboard never writes it",
};

const DDB_WRITES = [
  "dynamodb:PutItem",
  "dynamodb:UpdateItem",
  "dynamodb:DeleteItem",
  "dynamodb:ConditionCheckItem",
];

// dynamodb:LeadingKeys under ForAllValues:StringLike: `*` matches any run.
const stringLike = (pattern: string, value: string): boolean =>
  new RegExp(
    `^${pattern
      .split("*")
      .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*")}$`,
  ).test(value);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const isSource = (p: string) =>
  p.endsWith(".ts") && !/\.test\.ts$/.test(p) && !p.includes("/__tests__/");

type Builder = { name: string; file: string; prefix: string; exact: boolean };

// R2 (TRK1 review round 1): a builder is any `const <name> = ...;` or
// `function <name>(...) {...}` whose name is PK, pk, *Pk or *_PK - in ANY
// lib/data file, exported or not, template or plain string.
const isPkName = (name: string) => /^(pk|PK)$|(Pk|_PK)$/.test(name);

function prefixOf(
  body: string,
): { prefix: string; exact: boolean } | undefined {
  const tpl = body.indexOf("`");
  if (tpl >= 0) {
    const t = body.slice(tpl + 1);
    const close = t.indexOf("`");
    const inner = close < 0 ? t : t.slice(0, close);
    const interp = inner.indexOf("${");
    return {
      prefix: interp < 0 ? inner : inner.slice(0, interp),
      exact: interp < 0,
    };
  }
  const lit = /"([^"]*)"/.exec(body);
  return lit ? { prefix: lit[1] as string, exact: true } : undefined;
}

function parseBuildersFrom(src: string, file: string): Builder[] {
  const out: Builder[] = [];
  for (const m of src.matchAll(/\b(?:export\s+)?const (\w+)\b[^;]*;/g)) {
    const [stmt, name] = m as unknown as [string, string];
    if (!isPkName(name) || /gsi1/i.test(name)) continue;
    const eq = stmt.indexOf("=");
    const rhs = eq < 0 ? "" : stmt.slice(eq + 1).trim();
    // Only a literal or a builder arrow; `const pk = cond ? "gsi1pk" : "PK"`
    // names an attribute, not a key value.
    const isBuilder =
      /^[`"]/.test(rhs) ||
      /^(?:async\s+)?(?:\([^)]*\)|\w+)\s*(?::\s*[^=]+?)?\s*=>/.test(rhs);
    const p = isBuilder ? prefixOf(rhs) : undefined;
    if (p) out.push({ name, file, ...p });
  }
  for (const m of src.matchAll(
    /\b(?:export\s+)?function (\w+)\s*\([^)]*\)[^{]*\{([\s\S]*?)\n\}/g,
  )) {
    const [, name, body] = m as unknown as [string, string, string];
    if (!isPkName(name) || /gsi1/i.test(name)) continue;
    const ret = /return\s+([\s\S]*?);/.exec(body);
    const p = ret ? prefixOf(ret[1] as string) : undefined;
    if (p) out.push({ name, file, ...p });
  }
  return out;
}

function parseBuilders(file: string): Builder[] {
  return parseBuildersFrom(readFileSync(join(REPO, file), "utf8"), file);
}

const dataFiles = walk(DATA).filter(isSource);

// KEY_MODULES (incl. packages/shared) plus every other non-test lib/data file.
const scanned = [
  ...new Set([...KEY_MODULES, ...dataFiles.map((f) => relative(REPO, f))]),
];
const builders = scanned.flatMap(parseBuilders);
const byName = new Map(builders.map((b) => [b.name, b]));

// Inline `PK: ...` literals in lib/data give a prefix directly.
function inlinePrefixes(): { file: string; prefix: string; exact: boolean }[] {
  const out: { file: string; prefix: string; exact: boolean }[] = [];
  for (const f of dataFiles) {
    const src = readFileSync(f, "utf8");
    const file = relative(REPO, f);
    for (const m of src.matchAll(/\bPK:\s*`([^`]*)`/g)) {
      const body = m[1] as string;
      const end = body.indexOf("${");
      out.push({
        file,
        prefix: end < 0 ? body : body.slice(0, end),
        exact: end < 0,
      });
    }
    for (const m of src.matchAll(/\bPK:\s*"([^"]*)"/g)) {
      out.push({ file, prefix: m[1] as string, exact: true });
    }
  }
  return out;
}

// A `PK: fooPk(...)` reference must resolve to a parsed builder, else this
// test cannot see the key.
function unresolvedBuilderRefs(): string[] {
  const out: string[] = [];
  for (const f of dataFiles) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/\bPK:\s*([A-Za-z_]\w*(?:Pk|_PK))\b/g)) {
      if (!byName.has(m[1] as string)) {
        out.push(`${relative(REPO, f)}: ${m[1]}`);
      }
    }
  }
  return out;
}

const sample = (b: { prefix: string; exact: boolean }) =>
  b.exact ? b.prefix : `${b.prefix}x`;

describe("task-role write keys cover every partition key lib/data builds (Platform - Task role policy, TRK1)", () => {
  it("the matcher follows StringLike: LITELLM#* does not match LITELLMUSER#..., BRREQ#* does not match BRREQOPEN#... (Platform TRK1 amendment)", () => {
    expect(stringLike("LITELLM#*", "LITELLM#CONFIG")).toBe(true);
    expect(stringLike("LITELLM#*", "LITELLMUSER#abc")).toBe(false);
    expect(stringLike("BRREQ#*", "BRREQOPEN#t#o")).toBe(false);
    expect(stringLike("GOVERNANCE", "GOVERNANCE")).toBe(true);
    expect(stringLike("GOVERNANCE", "GOVERNANCEX")).toBe(false);
  });

  it("every *keys*.ts module under lib/data is parsed by this test (add new ones to KEY_MODULES)", () => {
    const found = dataFiles
      .filter((f) => /keys[^/]*\.ts$/.test(f))
      .map((f) => relative(REPO, f))
      .sort();
    const parsed = KEY_MODULES.filter((m) =>
      m.startsWith("apps/dashboard/lib/data/"),
    ).sort();
    expect(found).toEqual(parsed);
  });

  it("the parser finds the known builders (guards against a silently empty scan)", () => {
    for (const n of [
      "accountPk",
      "identPk",
      "GOVERNANCE_PK",
      "appTeamPk",
      "litellmUserPk",
      "brReqPk",
      "brReqOpenPk",
      "bResetPk",
      "notifPk",
      "teamLinkPk",
      "SYSTEM_PK",
    ]) {
      expect(byName.has(n), n).toBe(true);
    }
    expect(inlinePrefixes().some((p) => p.prefix === "IDENT#")).toBe(true);
  });

  it("R2: the parser sees local PK template/string consts and function builders, not only exported *Pk in *keys* files", () => {
    const src = [
      "const PK = `FOO#${id}`;",
      'const thing_PK = "BAR";',
      "function bazPk(id: string) {\n  return `BAZ#${id}`;\n}",
      "export const gsi1Pk = `NOPE#${x}`;",
    ].join("\n");
    const got = parseBuildersFrom(src, "x.ts").map(
      (b) => `${b.name}:${b.prefix}:${b.exact}`,
    );
    expect(got.sort()).toEqual(
      ["PK:FOO#:false", "bazPk:BAZ#:false", "thing_PK:BAR:true"].sort(),
    );
  });

  it("every `PK: <builder>` reference in lib/data resolves to a parsed key builder", () => {
    expect(unresolvedBuilderRefs()).toEqual([]);
  });

  describe.each<Mode>(["import", "create"])(
    "DashboardServiceStack (%s)",
    (mode) => {
      const t = synthApp(mode, "dev");
      const writePatterns = Object.values(t.findResources("AWS::IAM::Policy"))
        .flatMap(
          (r) => (r.Properties as Json).PolicyDocument.Statement as Json[],
        )
        .filter((st) => actionsOf(st).some((a) => DDB_WRITES.includes(a)))
        .flatMap((st) =>
          [].concat(
            st.Condition?.["ForAllValues:StringLike"]?.[
              "dynamodb:LeadingKeys"
            ] ?? [],
          ),
        ) as string[];

      const covered = (value: string) =>
        writePatterns.some((p) => stringLike(p, value)) ||
        Object.keys(READ_ONLY).some((p) => stringLike(`${p}*`, value));

      it("collects write patterns from the synthesized task role", () => {
        expect(writePatterns.length).toBeGreaterThan(0);
      });

      it("update infra/lib/dashboard-service/task.ts and the Platform spec row together: every exported *Pk builder prefix is writable or listed read-only", () => {
        const uncovered = builders
          .filter((b) => !covered(sample(b)))
          .map((b) => `${b.name} (${b.file}) -> ${b.prefix}`);
        expect(uncovered).toEqual([]);
      });

      it("update infra/lib/dashboard-service/task.ts and the Platform spec row together: every inline `PK:` literal in lib/data is writable or listed read-only", () => {
        const uncovered = inlinePrefixes()
          .filter((p) => !covered(sample(p)))
          .map((p) => `${p.file} -> ${p.prefix}`);
        expect(uncovered).toEqual([]);
      });

      it("the read-only list never overlaps a write pattern (SYSTEM stays unwritable)", () => {
        for (const p of Object.keys(READ_ONLY)) {
          const key = p.endsWith("#") ? `${p}x` : p;
          expect(
            writePatterns.filter((w) => stringLike(w, key)),
            p,
          ).toEqual([]);
        }
      });
    },
  );
});

// ---------------------------------------------------------------------------
// R1 (TRK1 review round 1): the action guard. Every DynamoDB *Command the app
// sends must map to an IAM action the synthesized task role grants on the
// table. An unmapped Command fails, so the map is extended deliberately.
// Source: Platform spec - Task role policy; Data Model - Notifications
// (createNotifications throws on a failed batch).
// ---------------------------------------------------------------------------
const TRANSACT_ITEM_ACTIONS = [
  "PutItem",
  "UpdateItem",
  "DeleteItem",
  "ConditionCheckItem",
];
const COMMAND_ACTIONS: Record<string, string[]> = {
  PutCommand: ["PutItem"],
  UpdateCommand: ["UpdateItem"],
  DeleteCommand: ["DeleteItem"],
  GetCommand: ["GetItem"],
  QueryCommand: ["Query"],
  ScanCommand: ["Scan"],
  BatchGetCommand: ["BatchGetItem"],
  BatchWriteCommand: ["BatchWriteItem"],
  TransactWriteCommand: TRANSACT_ITEM_ACTIONS,
  TransactGetCommand: ["GetItem"],
  DescribeTableCommand: ["DescribeTable"],
};

const isAppSource = (p: string) =>
  /\.tsx?$/.test(p) &&
  !/\.test\.tsx?$/.test(p) &&
  !p.endsWith(".d.ts") &&
  !p.includes("/__tests__/");

type CommandUse = { command: string; at: string };

function dynamoCommandUses(): {
  imported: CommandUse[];
  constructed: CommandUse[];
} {
  const imported: CommandUse[] = [];
  const constructed: CommandUse[] = [];
  const files = [
    ...walk(join(REPO, "apps/dashboard/lib")),
    ...walk(join(REPO, "apps/dashboard/app")),
  ].filter(isAppSource);
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    const rel = relative(REPO, f);
    for (const m of src.matchAll(
      /import\s+(type\s+)?\{([^}]*)\}\s+from\s+"@aws-sdk\/(?:lib|client)-dynamodb"/g,
    )) {
      if (m[1]) continue;
      for (const raw of (m[2] as string).split(",")) {
        const name =
          raw
            .trim()
            .replace(/^type\s+/, "")
            .split(/\s+as\s+/)[0] ?? "";
        if (!/Command$/.test(name)) continue;
        const line = src.slice(0, m.index).split("\n").length;
        imported.push({ command: name, at: `${rel}:${line}` });
        for (const c of src.matchAll(new RegExp(`new ${name}\\(`, "g"))) {
          const cl = src.slice(0, c.index).split("\n").length;
          constructed.push({ command: name, at: `${rel}:${cl}` });
        }
      }
    }
  }
  return { imported, constructed };
}

const uses = dynamoCommandUses();

const needed = new Map<string, string[]>();
for (const u of uses.constructed) {
  for (const a of COMMAND_ACTIONS[u.command] ?? []) {
    needed.set(`dynamodb:${a}`, [
      ...(needed.get(`dynamodb:${a}`) ?? []),
      `${u.command} at ${u.at}`,
    ]);
  }
}

function taskRoleStatements(t: ReturnType<typeof synthApp>): Json[] {
  const [td] = Object.values(t.findResources("AWS::ECS::TaskDefinition"));
  const roleId = (
    ((td?.Properties as Json).TaskRoleArn as Json)["Fn::GetAtt"] as string[]
  )[0] as string;
  return Object.values(t.findResources("AWS::IAM::Policy"))
    .filter((r) =>
      JSON.stringify((r.Properties as Json).Roles).includes(`"${roleId}"`),
    )
    .flatMap((r) => (r.Properties as Json).PolicyDocument.Statement as Json[]);
}

describe("task-role actions cover every DynamoDB Command the app sends (Platform - Task role policy, TRK1 R1)", () => {
  it("the scan finds the known Commands (guards against a silently empty scan)", () => {
    const names = new Set(uses.constructed.map((u) => u.command));
    for (const n of [
      "QueryCommand",
      "UpdateCommand",
      "TransactWriteCommand",
      "BatchWriteCommand",
      "BatchGetCommand",
      "ScanCommand",
      "DescribeTableCommand",
    ]) {
      expect(names.has(n), n).toBe(true);
    }
  });

  it("every *Command imported from the DynamoDB SDKs is in COMMAND_ACTIONS (extend the map deliberately for a new Command)", () => {
    const unknown = uses.imported
      .filter((u) => !(u.command in COMMAND_ACTIONS))
      .map((u) => `${u.command} at ${u.at}`);
    expect(unknown).toEqual([]);
  });

  describe.each<Mode>(["import", "create"])(
    "DashboardServiceStack (%s)",
    (mode) => {
      const t = synthApp(mode, "dev");
      const stmts = taskRoleStatements(t);

      it.each([...needed.entries()].sort())(
        "update infra/lib/dashboard-service/task.ts and the Platform spec row together: the task role grants %s on the table (needed by %j)",
        (action, by) => {
          expect(by.length).toBeGreaterThan(0);
          const grant = stmts.find(
            (st) =>
              st.Effect === "Allow" &&
              actionsOf(st).includes(action) &&
              [st.Resource].flat().some((r) => {
                const j = JSON.stringify(r);
                return j.includes("tablearn") && !j.includes("/index/");
              }),
          );
          expect(grant, `${action} needed by ${by.join(", ")}`).toBeDefined();
        },
      );
    },
  );
});
