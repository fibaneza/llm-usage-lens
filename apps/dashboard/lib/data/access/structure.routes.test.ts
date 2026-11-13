import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import * as shared from "@llm-usage-lens/shared";
import { describe, expect, it } from "vitest";

// Source: docs/specs/2026-11-10-access-control.md — "Storage boundary (D26.2)":
// Route Handlers and pages call the domain functions only; transaction and
// paging internals stay inside lib/data/access (R2a reviewer warning carried
// into R2b). Also D26.3 (amended R2a): access-control key builders leave the
// shared entry point (`identPk` moves to lib/data/access/keys.ts).
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const SKIP = new Set(["node_modules", ".next", "cdk.out", "dist", ".git"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

// Internals: modules that must never be imported at all, and symbols that must
// never be imported by name from the modules that also export domain helpers.
const FORBIDDEN_MODULES = ["store", "paging", "cursor"];
const FORBIDDEN_SYMBOLS: Record<string, string[]> = {
  audit: ["auditPutItem", "appendAuditRecord", "TransactItem", "toItem"],
  store: ["getItem", "commitAudited"],
};

type Offence = { module: string; symbol?: string };

export function accessInternalOffences(source: string): Offence[] {
  const offences: Offence[] = [];
  const re =
    /import\s+(?:type\s+)?(?:\{([^}]*)\}|\*\s+as\s+\w+|\w+)\s+from\s*["'][^"']*\/access\/([\w-]+)["']/g;
  for (const match of source.matchAll(re)) {
    const names = (match[1] ?? "")
      .split(",")
      .map(
        (n) =>
          n
            .trim()
            .replace(/^type\s+/, "")
            .split(/\s+as\s+/)[0] ?? "",
      )
      .filter(Boolean);
    const mod = match[2] ?? "";
    if (FORBIDDEN_MODULES.includes(mod)) offences.push({ module: mod });
    for (const symbol of FORBIDDEN_SYMBOLS[mod] ?? []) {
      if (names.includes(symbol)) offences.push({ module: mod, symbol });
    }
    if (!match[1] && FORBIDDEN_SYMBOLS[mod]) {
      offences.push({ module: mod, symbol: "*" });
    }
  }
  return offences;
}

describe("accessInternalOffences (guard self-check)", () => {
  it("flags internals, namespace imports and allows domain functions", () => {
    expect(
      accessInternalOffences(
        `import { auditPutItem } from "@/lib/data/access/audit";`,
      ),
    ).toEqual([{ module: "audit", symbol: "auditPutItem" }]);
    expect(
      accessInternalOffences(
        `import type { TransactItem as T } from "@/lib/data/access/audit";`,
      ),
    ).toEqual([{ module: "audit", symbol: "TransactItem" }]);
    expect(
      accessInternalOffences(`import { queryPage } from "../access/paging";`),
    ).toEqual([{ module: "paging" }]);
    expect(
      accessInternalOffences(`import * as s from "@/lib/data/access/store";`),
    ).toEqual([{ module: "store" }, { module: "store", symbol: "*" }]);
    expect(
      accessInternalOffences(
        `import { addMember } from "@/lib/data/access/affiliations";\nimport { listAuditRecords } from "@/lib/data/access/audit";`,
      ),
    ).toEqual([]);
  });
});

const consumerFiles = ["app", "components", "hooks"]
  .map((d) => join(ROOT, "apps/dashboard", d))
  .filter((d) => existsSync(d))
  .flatMap((d) => walk(d))
  .map((f) => relative(ROOT, f).split(sep).join("/"))
  .filter((f) => !/\.test\.tsx?$/.test(f));

describe("route handlers, pages and components use domain functions only", () => {
  it("scans a non-trivial set of consumer files", () => {
    expect(consumerFiles.length).toBeGreaterThan(20);
  });

  it("none imports the store, paging or cursor internals, or audit-transaction helpers", () => {
    const offenders = consumerFiles
      .map((f) => ({
        file: f,
        offences: accessInternalOffences(readFileSync(join(ROOT, f), "utf8")),
      }))
      .filter((o) => o.offences.length > 0);
    expect(offenders).toEqual([]);
  });
});

describe("access-control key builders leave the shared entry point", () => {
  it("@llm-usage-lens/shared no longer exports identPk (it lives in lib/data/access/keys.ts)", () => {
    expect(Object.keys(shared)).not.toContain("identPk");
  });

  it("keys.ts still exports identPk", () => {
    const src = readFileSync(
      join(ROOT, "apps/dashboard/lib/data/access/keys.ts"),
      "utf8",
    );
    expect(src).toMatch(/export const identPk/);
  });
});
