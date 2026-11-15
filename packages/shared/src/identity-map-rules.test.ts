import { describe, expect, it } from "vitest";

import * as shared from "./index";
import {
  IdentityMapRuleSchema,
  IdentityMapRulesInputSchema,
  IdentityMapRulesSchema,
  MAX_IDENTITY_MAP_RULES,
  mapUsageKeyToEmail,
  suggestIdentityLinks,
} from "./identity-map-rules";
import {
  AuditActionSchema,
  auditCategory,
  sanitizeAuditSnapshot,
} from "./schemas/access-control";

// Source: docs/specs/2026-11-10-access-control.md - "Membership, admin scopes
// and lifecycle", "Usage-identity mapping rules (D27)": a pattern with one
// `{name}` placeholder over the session name and a template for the email;
// rules only SUGGEST a link for a non-person usage key that maps to an existing
// identity's email; matching is exact, never fuzzy; rules never grant access
// and never map to a person automatically. "Canonical usage identity" (a key
// that is a valid email is a person; lower-case), "Audit log" (every change is
// audited; before/after keep allowlisted keys only), implementation-phases
// 4R.4 (D27 bullet).
//
// Decisions the spec leaves open (resolved here, reported to the orchestrator):
// - rules are an ordered list; the FIRST rule whose pattern matches a key
//   decides its email (no fall-through to a later rule);
// - the pattern is matched against the session name (the substring after the
//   last "/" or ":" of the key), case-insensitively, over the whole name;
//   `{name}` matches one or more characters other than whitespace, "@", "/" and
//   ":"; every other pattern character is literal;
// - the output email and the suggested usage key are lower-cased and trimmed
//   (the form the identity-link route stores);
// - at most 20 rules; patterns are unique (case-insensitively).
const SSO = { pattern: "{name}-sso", template: "{name}@company.com" };

describe("IdentityMapRuleSchema", () => {
  it.each([
    SSO,
    { pattern: "{name}", template: "{name}@company.com" },
    { pattern: "sso.{name}", template: "{name}@company.com" },
    { pattern: "svc_{name}_prod", template: "{name}@Example.org" },
    { pattern: "{name}.sso", template: "{name}@company.com" },
  ])("accepts %j", (rule) => {
    expect(IdentityMapRuleSchema.safeParse(rule).success).toBe(true);
  });

  it.each([
    ["an empty pattern", { pattern: "", template: "{name}@company.com" }],
    ["a pattern without the placeholder", { ...SSO, pattern: "jane-sso" }],
    ["a pattern with two placeholders", { ...SSO, pattern: "{name}-{name}" }],
    [
      "a pattern with an unclosed placeholder",
      { ...SSO, pattern: "{name-sso" },
    ],
    ["a pattern with a misspelt placeholder", { ...SSO, pattern: "{nam}-sso" }],
    ["a pattern with another placeholder", { ...SSO, pattern: "{name}-{x}" }],
    ["a pattern with a stray brace", { ...SSO, pattern: "}{name}" }],
    [
      "a pattern over 200 characters",
      { ...SSO, pattern: `{name}${"a".repeat(200)}` },
    ],
    ["a template that is not an email", { ...SSO, template: "{name}" }],
    ["a template without a domain", { ...SSO, template: "{name}@" }],
    ["a template without a local part", { ...SSO, template: "@company.com" }],
    [
      "a template without the placeholder",
      { ...SSO, template: "jane@company.com" },
    ],
    [
      "a template with two placeholders",
      { ...SSO, template: "{name}.{name}@company.com" },
    ],
    [
      "a template containing a space",
      { ...SSO, template: "{name} @company.com" },
    ],
    ["a missing template", { pattern: "{name}-sso" }],
    ["a missing pattern", { template: "{name}@company.com" }],
    ["a numeric pattern", { ...SSO, pattern: 7 }],
    ["null", null],
  ])("rejects %s", (_name, rule) => {
    expect(IdentityMapRuleSchema.safeParse(rule).success).toBe(false);
  });
});

describe("IdentityMapRulesInputSchema (the PUT body rules)", () => {
  it("accepts an empty list (delete the last rule) and keeps the order", () => {
    expect(IdentityMapRulesInputSchema.safeParse({ rules: [] }).success).toBe(
      true,
    );
    const rules = [
      SSO,
      { pattern: "svc-{name}", template: "{name}@company.com" },
    ];
    const parsed = IdentityMapRulesInputSchema.parse({ rules });
    expect(parsed.rules).toEqual(rules);
  });

  it("caps the list at MAX_IDENTITY_MAP_RULES (20)", () => {
    expect(MAX_IDENTITY_MAP_RULES).toBe(20);
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        pattern: `p${i}-{name}`,
        template: "{name}@company.com",
      }));
    expect(
      IdentityMapRulesInputSchema.safeParse({ rules: many(20) }).success,
    ).toBe(true);
    expect(
      IdentityMapRulesInputSchema.safeParse({ rules: many(21) }).success,
    ).toBe(false);
  });

  it.each([
    ["an identical pattern", [SSO, { ...SSO, template: "{name}@other.com" }]],
    [
      "a pattern differing only in case",
      [SSO, { pattern: "{name}-SSO", template: "{name}@other.com" }],
    ],
  ])(
    "rejects %s twice in the list (the first match would shadow the second)",
    (_n, rules) => {
      expect(IdentityMapRulesInputSchema.safeParse({ rules }).success).toBe(
        false,
      );
    },
  );

  it.each([
    ["no rules key", {}],
    ["rules that is not a list", { rules: SSO }],
    [
      "a list holding an invalid rule",
      { rules: [{ pattern: "x", template: "y" }] },
    ],
  ])("rejects %s", (_n, body) => {
    expect(IdentityMapRulesInputSchema.safeParse(body).success).toBe(false);
  });
});

describe("IdentityMapRulesSchema (the stored item)", () => {
  const stored = {
    rules: [SSO],
    version: 1,
    updatedAt: "2026-11-15T09:30:00.000Z",
  };

  it("accepts rules, an integer version >= 0 and an ISO updatedAt", () => {
    expect(IdentityMapRulesSchema.parse(stored)).toEqual(stored);
  });

  it.each([
    ["a string version", { ...stored, version: "1" }],
    ["a fractional version", { ...stored, version: 1.5 }],
    ["a missing version", { rules: stored.rules, updatedAt: stored.updatedAt }],
    ["a missing updatedAt", { rules: stored.rules, version: 1 }],
    ["a malformed updatedAt", { ...stored, updatedAt: "yesterday" }],
    [
      "an invalid rule",
      { ...stored, rules: [{ pattern: "x", template: "y" }] },
    ],
  ])("rejects %s", (_n, value) => {
    expect(IdentityMapRulesSchema.safeParse(value).success).toBe(false);
  });
});

describe("mapUsageKeyToEmail", () => {
  it("maps the session name through the pattern and template, returning the matching pattern", () => {
    expect(mapUsageKeyToEmail([SSO], "jane-sso")).toEqual({
      email: "jane@company.com",
      pattern: "{name}-sso",
    });
    expect(mapUsageKeyToEmail([SSO], "first.last-sso")?.email).toBe(
      "first.last@company.com",
    );
  });

  it("is case-insensitive and always returns a lower-case email", () => {
    expect(mapUsageKeyToEmail([SSO], "Jane-SSO")?.email).toBe(
      "jane@company.com",
    );
    expect(
      mapUsageKeyToEmail(
        [{ pattern: "{name}-sso", template: "{name}@Company.COM" }],
        "jane-sso",
      )?.email,
    ).toBe("jane@company.com");
  });

  it("maps the session name of an SSO assumed-role ARN (the substring after the last / or :)", () => {
    expect(
      mapUsageKeyToEmail(
        [SSO],
        "arn:aws:sts::000000000000:assumed-role/AWSReservedSSO_Set_abc123/jane-sso",
      )?.email,
    ).toBe("jane@company.com");
  });

  it.each([
    ["a key that does not match", "jane-svc"],
    ["an empty name", "-sso"],
    ["trailing characters after the pattern", "jane-sso-extra"],
    ["an empty key", ""],
  ])("returns null for %s", (_n, key) => {
    expect(mapUsageKeyToEmail([SSO], key)).toBeNull();
  });

  it("returns null with no rules", () => {
    expect(mapUsageKeyToEmail([], "jane-sso")).toBeNull();
  });

  it("matches the whole name: a literal prefix must be present", () => {
    const rules = [{ pattern: "sso-{name}", template: "{name}@company.com" }];
    expect(mapUsageKeyToEmail(rules, "sso-jane")?.email).toBe(
      "jane@company.com",
    );
    expect(mapUsageKeyToEmail(rules, "jane-sso")).toBeNull();
    expect(mapUsageKeyToEmail(rules, "xsso-jane")).toBeNull();
  });

  it("treats regex metacharacters in the pattern literally", () => {
    const dot = [{ pattern: "{name}.sso", template: "{name}@company.com" }];
    expect(mapUsageKeyToEmail(dot, "jane.sso")?.email).toBe("jane@company.com");
    expect(mapUsageKeyToEmail(dot, "janexsso")).toBeNull();
    const plus = [{ pattern: "a+{name}", template: "{name}@company.com" }];
    expect(mapUsageKeyToEmail(plus, "a+jane")?.email).toBe("jane@company.com");
    expect(mapUsageKeyToEmail(plus, "aajane")).toBeNull();
    const parens = [{ pattern: "({name})", template: "{name}@company.com" }];
    expect(mapUsageKeyToEmail(parens, "(jane)")?.email).toBe(
      "jane@company.com",
    );
  });

  it("the first matching rule wins, and the order decides which", () => {
    const specific = SSO;
    const catchAll = { pattern: "{name}", template: "{name}@other.com" };
    expect(mapUsageKeyToEmail([specific, catchAll], "jane-sso")).toEqual({
      email: "jane@company.com",
      pattern: "{name}-sso",
    });
    expect(mapUsageKeyToEmail([specific, catchAll], "jane")?.email).toBe(
      "jane@other.com",
    );
    expect(mapUsageKeyToEmail([catchAll, specific], "jane-sso")).toEqual({
      email: "jane-sso@other.com",
      pattern: "{name}",
    });
  });

  it("never maps a key that is already a person (a valid email)", () => {
    const catchAll = [{ pattern: "{name}", template: "{name}@company.com" }];
    expect(mapUsageKeyToEmail(catchAll, "jane@company.com")).toBeNull();
    expect(
      mapUsageKeyToEmail(
        catchAll,
        "arn:aws:sts::000000000000:assumed-role/AWSReservedSSO_X_Y/Jane.Doe@Company.com",
      ),
    ).toBeNull();
  });

  it("does not mutate the rules", () => {
    const rules = [{ ...SSO }];
    const copy = structuredClone(rules);
    mapUsageKeyToEmail(rules, "jane-sso");
    expect(rules).toEqual(copy);
  });
});

describe("suggestIdentityLinks", () => {
  const alice = { oid: "oid-alice", email: "alice@company.com" };
  const bob = { oid: "oid-bob", email: "bob@company.com" };
  const base = { rules: [SSO], identities: [alice, bob], claimedKeys: [] };

  it("suggests a link only for a non-person key that a rule maps to an existing identity's email", () => {
    expect(
      suggestIdentityLinks({
        ...base,
        usageKeys: ["alice-sso", "zed-sso", "bob@company.com", "carol-svc"],
      }),
    ).toEqual([
      {
        pattern: "{name}-sso",
        usageKey: "alice-sso",
        email: "alice@company.com",
        oid: "oid-alice",
      },
    ]);
  });

  it("matches the identity email case-insensitively and lower-cases the suggested key", () => {
    expect(
      suggestIdentityLinks({
        ...base,
        identities: [{ oid: "oid-bob", email: "Bob@Company.COM" }],
        usageKeys: ["Bob-SSO"],
      }),
    ).toEqual([
      {
        pattern: "{name}-sso",
        usageKey: "bob-sso",
        email: "bob@company.com",
        oid: "oid-bob",
      },
    ]);
  });

  it("suggests nothing without rules, keys or identities", () => {
    expect(
      suggestIdentityLinks({ ...base, rules: [], usageKeys: ["alice-sso"] }),
    ).toEqual([]);
    expect(suggestIdentityLinks({ ...base, usageKeys: [] })).toEqual([]);
    expect(
      suggestIdentityLinks({
        ...base,
        identities: [],
        usageKeys: ["alice-sso"],
      }),
    ).toEqual([]);
  });

  it("ignores an identity without an email", () => {
    expect(
      suggestIdentityLinks({
        ...base,
        identities: [{ oid: "oid-x" }, { oid: "oid-y", email: undefined }],
        usageKeys: ["alice-sso"],
      }),
    ).toEqual([]);
  });

  it("suggests nothing when two identities share the mapped email (fail closed: matching is exact, never a guess)", () => {
    expect(
      suggestIdentityLinks({
        ...base,
        identities: [alice, { oid: "oid-alice-2", email: "ALICE@company.com" }],
        usageKeys: ["alice-sso"],
      }),
    ).toEqual([]);
  });

  it("omits a key that is already claimed by anyone (it would be a 409), compared case-insensitively", () => {
    expect(
      suggestIdentityLinks({
        ...base,
        claimedKeys: ["alice-sso", "BOB-SSO"],
        usageKeys: ["alice-sso", "bob-sso"],
      }),
    ).toEqual([]);
  });

  it("lists a key once however many times and in whatever case it appears", () => {
    const out = suggestIdentityLinks({
      ...base,
      usageKeys: ["alice-sso", "Alice-SSO", "alice-sso"],
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.usageKey).toBe("alice-sso");
  });

  it("the first matching rule decides: no suggestion when it maps to an unknown email even if a later rule would match an identity", () => {
    const rules = [
      { pattern: "{name}-sso", template: "{name}@unknown.example" },
      { pattern: "{name}-sso", template: "{name}@company.com" },
    ];
    // Duplicate patterns are invalid as stored input, but the pure function
    // still honours list order.
    expect(
      suggestIdentityLinks({ ...base, rules, usageKeys: ["alice-sso"] }),
    ).toEqual([]);
  });

  it("orders by rule position, then usage key, whatever the input order", () => {
    const rules = [
      { pattern: "svc-{name}", template: "{name}@company.com" },
      SSO,
    ];
    const out = suggestIdentityLinks({
      ...base,
      rules,
      usageKeys: ["bob-sso", "svc-bob", "alice-sso", "svc-alice"],
    });
    expect(out.map((s) => s.usageKey)).toEqual([
      "svc-alice",
      "svc-bob",
      "alice-sso",
      "bob-sso",
    ]);
  });

  it("does not mutate its inputs", () => {
    const input = {
      ...base,
      usageKeys: ["bob-sso", "alice-sso"],
      claimedKeys: ["x"],
    };
    const copy = structuredClone(input);
    suggestIdentityLinks(input);
    expect(input).toEqual(copy);
  });

  it("a suggestion carries only pattern, usageKey, email and oid (no identity fields leak)", () => {
    const out = suggestIdentityLinks({
      ...base,
      identities: [
        { ...alice, displayName: "Alice", roles: ["internal-admin"] } as never,
      ],
      usageKeys: ["alice-sso"],
    });
    expect(Object.keys(out[0] ?? {}).sort()).toEqual([
      "email",
      "oid",
      "pattern",
      "usageKey",
    ]);
  });
});

describe("audit vocabulary for the rules item", () => {
  it("identity.map.update is an audit action and a change (not a security) record", () => {
    expect(AuditActionSchema.safeParse("identity.map.update").success).toBe(
      true,
    );
    expect(auditCategory("identity.map.update")).toBe("change");
  });

  it("the snapshot sanitiser keeps a `rules` string list and the version", () => {
    expect(
      sanitizeAuditSnapshot({
        rules: ["{name}-sso -> {name}@company.com"],
        version: 2,
        password: "never",
      }),
    ).toEqual({ rules: ["{name}-sso -> {name}@company.com"], version: 2 });
  });
});

describe("public exports", () => {
  it("re-exports the schemas and functions from the package entry", () => {
    expect(shared.IdentityMapRuleSchema).toBe(IdentityMapRuleSchema);
    expect(shared.IdentityMapRulesInputSchema).toBe(
      IdentityMapRulesInputSchema,
    );
    expect(shared.IdentityMapRulesSchema).toBe(IdentityMapRulesSchema);
    expect(shared.MAX_IDENTITY_MAP_RULES).toBe(MAX_IDENTITY_MAP_RULES);
    expect(shared.mapUsageKeyToEmail).toBe(mapUsageKeyToEmail);
    expect(shared.suggestIdentityLinks).toBe(suggestIdentityLinks);
  });
});
