import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { beforeEach, vi } from "vitest";

import { putIdentityLink } from "@/lib/data/access/identity-links";
import { createFakeLiteLLM } from "@/test/fakes/fake-litellm";
import { combinedHandler } from "@/test/fakes/fake-litellm-combined";
import type { CombinedFakeOptions } from "@/test/fakes/fake-litellm-combined";
import { LUSER, setupViewsSuite } from "@/test/fakes/fake-litellm-views";
import type { Suite } from "@/test/fakes/fake-litellm-views";
import { CALLERS } from "@/test/fixtures/scope-fixtures";
import { buildRollup } from "@/test/fixtures/rollup-builder";
import { ctxAt, ok } from "@/test/support/access-test-support";
import {
  TEST_TABLE_NAME,
  loadFixtures,
  testDoc,
} from "@/test/support/test-support";

// Test-only harness for the L6 combined route suites (not imported by
// production code). Rule 60.22: DynamoDB Local, the real policy module and
// audit; only `@/auth` and the in-process fake LiteLLM are injected (Rule
// 60.24). Source: docs/specs/2026-11-10-litellm.md - "Combined usage and My
// usage (L6)" (Gateway configuration: LITELLM#CONFIG / GATEWAY; Routes; States).
//
// The world is the L3 views world (four linked teams on accounts
// 000000000001..04, rollups 2026-10-01..03) plus one unlinked team, team-u, on
// account 000000000000, with one rollup of cost 3 on 2026-10-01 whose byUser
// holds a1's second usage key (linked below) and u1:
//   per team over RANGE: team-a 33 (a1 21, a2 12), team-b 69, team-c 123,
//   team-m 15, team-u 3; organisation Bedrock total 243.
// memberA (a1@company.com, LiteLLM user a1@company.com) owns the usage keys
// a1@company.com and a1-alt@company.com: direct Bedrock 21 + 2 = 23.

export const RANGE = "dateFrom=2026-10-01&dateTo=2026-10-03";
export const GW_ACCOUNT_B = "000000000002";
export const GW_ACCOUNT_A = "000000000001";
export const ALT_KEY = "a1-alt@company.com";
export const GATEWAY_PK = "LITELLM#CONFIG";
export const GATEWAY_SK = "GATEWAY";

export async function storeGateway(
  config: {
    principals?: Array<{ type: "iam-role" | "usage-key"; value: string }>;
    accountIds?: string[];
    version?: number;
  } = {},
) {
  await testDoc().send(
    new PutCommand({
      TableName: TEST_TABLE_NAME,
      Item: {
        PK: GATEWAY_PK,
        SK: GATEWAY_SK,
        principals: config.principals ?? [],
        accountIds: config.accountIds ?? [],
        version: config.version ?? 1,
        updatedAt: "2026-11-14T10:00:00.000Z",
        updatedBy: CALLERS.admin.oid,
      },
    }),
  );
}

export async function seedCombinedExtras() {
  await loadFixtures({
    rollups: [
      buildRollup({
        date: "2026-10-01",
        accountId: "000000000000",
        departmentId: "dept-eng",
        departmentName: "Engineering",
        teamId: "team-u",
        teamName: "U",
        models: {
          "claude-sonnet": {
            cost: 3,
            byUser: { [ALT_KEY]: 2, "u1@company.com": 1 },
          },
        },
      }),
    ],
  });
  ok(
    await putIdentityLink(
      {
        oid: CALLERS.memberA.oid,
        usageIdentities: [CALLERS.memberA.email, ALT_KEY],
        aliases: [],
        litellmUserId: LUSER.memberA,
        version: 1,
      },
      ctxAt(undefined, "req-ident-alt"),
    ),
  );
}

// Registers the views suite hooks, then (hooks run in order) the combined
// extras and the combined fake. `state.fake` is the combined fake.
export function setupCombinedSuite(
  opts: () => CombinedFakeOptions = () => ({}),
): Suite {
  const state = setupViewsSuite();
  beforeEach(async () => {
    await seedCombinedExtras();
    installCombined(state, opts());
  });
  return state;
}

export function installCombined(state: Suite, opts: CombinedFakeOptions = {}) {
  state.fake = createFakeLiteLLM(combinedHandler(opts));
  vi.stubGlobal("fetch", state.fake.fetch);
}

export const callsTo = (state: Suite, path: string) =>
  state.fake.calls.filter((c) => c.path === path);

// Every figure key a hidden body must not carry (LT29, LT32).
export const FIGURE_KEYS = [
  "combined",
  "gatewaySlice",
  "reconciliation",
  "bedrockDirect",
  "bedrockExact",
  "litellm",
  "byProvider",
  "teams",
] as const;
