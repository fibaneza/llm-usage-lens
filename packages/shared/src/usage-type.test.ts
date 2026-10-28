import { describe, expect, expectTypeOf, it } from "vitest";

import { classifyUsageType as classifyFromIndex } from "./index";
import { MODEL_KEYS, ModelKeySchema } from "./models";
import { NON_MODEL_CATEGORIES } from "./schemas/non-model-charge";
import { classifyUsageType } from "./usage-type";
import type { ModelKey } from "./models";
import type { NonModelCategory } from "./schemas/non-model-charge";

// Source: docs/specs/2026-05-15-system-architecture.md — "Cost Explorer
// USAGE_TYPE classification" (ordered table, rules) and
// docs/specs/2026-05-15-implementation-phases.md — Phase 3.1a tasks.
//
// ILLUSTRATIVE FIXTURES ONLY. The spec marks every usage-type string and
// substring as an unverified pattern family (confirmed against a real
// GetCostAndUsage response in Phase 6). The strings below are made-up inputs
// shaped like the spec's examples; they are NOT real AWS USAGE_TYPE values.
// Phase 6 replaces/extends them with captured real strings.
//
// Marker literals (orchestrator decision, unverified): guardrails `Guardrail`,
// `ContentFilter`, `DeniedTopic`, `SensitiveInformation`,
// `ContextualGrounding`, `AutomatedReasoning`; agents `Agent` (covers
// `AgentCore`); other-features `PromptRouting`, `PromptOptimization`,
// `WebSearch`. Region prefix: at most one `^[A-Z]{2,4}[0-9]+-` strip,
// case-sensitive, before case folding.

type NonModelResult = Extract<
  ReturnType<typeof classifyUsageType>,
  { kind: "nonModel" }
>;

const nonModel = (category: NonModelResult["category"]) => ({
  kind: "nonModel",
  category,
});
const model = (key: ModelKey) => ({ kind: "model", key });
const UNCLASSIFIED = { kind: "unclassified" };

describe("classifyUsageType — contract", () => {
  it("is exported from the package entry point", () => {
    expect(classifyFromIndex).toBe(classifyUsageType);
  });

  it("returns the spec's discriminated union (nonModel category excludes unclassified)", () => {
    expectTypeOf<NonModelResult["category"]>().toEqualTypeOf<
      Exclude<NonModelCategory, "unclassified">
    >();
    expectTypeOf(classifyUsageType).parameter(0).toEqualTypeOf<string>();
  });

  it("returns exactly the spec shapes, with no extra keys", () => {
    expect(classifyUsageType("USE1-Guardrail-ContentFilter")).toStrictEqual({
      kind: "nonModel",
      category: "guardrails",
    });
    expect(classifyUsageType("USE1-ClaudeSonnet-input-tokens")).toStrictEqual({
      kind: "model",
      key: "claude-sonnet",
    });
    expect(classifyUsageType("USE1-Mystery")).toStrictEqual({
      kind: "unclassified",
    });
  });

  it("carries no `recurring` flag: the collector derives it from the category", () => {
    expect(
      classifyUsageType("USE1-ProvisionedThroughput-NoCommit"),
    ).toStrictEqual({ kind: "nonModel", category: "provisioned-throughput" });
    expect(
      classifyUsageType("USE1-KnowledgeBase-Storage-GBMonth"),
    ).toStrictEqual({ kind: "nonModel", category: "knowledge-bases" });
    expect(classifyUsageType("USE1-KnowledgeBase-Retrieval")).toStrictEqual({
      kind: "nonModel",
      category: "knowledge-bases",
    });
  });

  it("is pure: repeated calls give equal results (no stateful regex)", () => {
    const inputs = [
      "USE1-Guardrail-ContentFilter",
      "USE1-BDA-Pages",
      "USE1-ClaudeOpus-input-tokens",
      "USE1-Mystery",
    ];
    const first = inputs.map((i) => classifyUsageType(i));
    for (let round = 0; round < 5; round += 1) {
      expect(inputs.map((i) => classifyUsageType(i))).toEqual(first);
    }
  });

  it("only ever returns a valid model key or non-unclassified category", () => {
    const samples = [
      "USE1-Guardrail-ContentFilter",
      "USE1-CustomModelUnit-Minutes",
      "USE1-ClaudeHaiku-output-tokens",
      "USE1-NovaPro-input-tokens",
      "USE1-Mystery",
      "",
    ];
    for (const s of samples) {
      const r = classifyUsageType(s);
      if (r.kind === "model") {
        expect(ModelKeySchema.safeParse(r.key).success).toBe(true);
      } else if (r.kind === "nonModel") {
        expect(NON_MODEL_CATEGORIES).toContain(r.category);
        expect(r.category).not.toBe("unclassified");
      }
    }
  });
});

describe("classifyUsageType — region prefix", () => {
  it.each([
    "Guardrail-ContentFilter",
    "ProvisionedThroughput-ClaudeSonnet-1Month",
    "ClaudeOpus-input-tokens",
    "Pages-BDA",
    "BDA-Pages",
    "Mystery",
  ])(
    "a region prefix (USE1-/EUC1-/APS2-) on %s does not change the result",
    (rest) => {
      expect(classifyUsageType(`USE1-${rest}`)).toEqual(
        classifyUsageType(rest),
      );
      expect(classifyUsageType(`EUC1-${rest}`)).toEqual(
        classifyUsageType(rest),
      );
      expect(classifyUsageType(`APS2-${rest}`)).toEqual(
        classifyUsageType(rest),
      );
    },
  );

  it("an unprefixed BDA-Pages is data-automation (BDA- is not a region prefix: no digits)", () => {
    expect(classifyUsageType("BDA-Pages")).toEqual(nonModel("data-automation"));
    expect(classifyUsageType("BDA-Pages")).not.toEqual(UNCLASSIFIED);
  });

  it("strips a region-shaped prefix (2-4 capitals + digits) before matching", () => {
    // "FLOW1-" has the region shape, so it is removed and the Flows marker
    // inside it must not match.
    expect(classifyUsageType("FLOW1-Foo")).toEqual(UNCLASSIFIED);
    expect(classifyUsageType("USE1-Foo")).toEqual(UNCLASSIFIED);
    expect(classifyUsageType("EUC1-Foo")).toEqual(UNCLASSIFIED);
    expect(classifyUsageType("APS2-Foo")).toEqual(UNCLASSIFIED);
  });

  it("does not strip capitals-only segments, even when they contain a marker", () => {
    expect(classifyUsageType("FLOW-Foo")).toEqual(nonModel("flows"));
    expect(classifyUsageType("GUARDRAIL-Foo")).toEqual(nonModel("guardrails"));
  });

  it("strips at most one prefix", () => {
    // After removing "USE1-", the remaining "FLOW1-" is left in place.
    expect(classifyUsageType("USE1-FLOW1-Foo")).toEqual(nonModel("flows"));
  });

  it("prefix stripping is case-sensitive (applied before case folding)", () => {
    // Lower-case "flow1-" is not a region prefix, so the Flows marker survives.
    expect(classifyUsageType("flow1-Foo")).toEqual(nonModel("flows"));
    expect(classifyUsageType("use1-Foo")).toEqual(UNCLASSIFIED);
  });
});

describe("classifyUsageType — non-model categories (rows 1-11)", () => {
  it.each([
    ["USE1-Guardrail-TextUnits", "guardrails"],
    ["USE1-Guardrails-ImageUnits", "guardrails"],
    ["USE1-ContentFilter-TextUnits", "guardrails"],
    ["USE1-DeniedTopic-TextUnits", "guardrails"],
    ["USE1-SensitiveInformation-TextUnits", "guardrails"],
    ["USE1-ContextualGrounding-TextUnits", "guardrails"],
    ["USE1-AutomatedReasoning-TextUnits", "guardrails"],
    ["USE1-CustomModelUnit-Minutes", "custom-model-import"],
    ["USE1-ModelImport-Storage", "custom-model-import"],
    ["USE1-CustomModelStorage-Month", "custom-model-storage"],
    ["USE1-CustomModel-Storage-Month", "custom-model-storage"],
    ["USE1-ProvisionedThroughput-NoCommit", "provisioned-throughput"],
    ["USE1-ModelUnit-Hours-6Month", "provisioned-throughput"],
    ["USE1-Customization-TrainingTokens", "model-customization"],
    ["USE1-FineTuning-Hours", "model-customization"],
    ["USE1-Training-Hours", "model-customization"],
    ["USE1-KnowledgeBase-Storage-GBMonth", "knowledge-bases"],
    ["USE1-Retrieve-Requests", "knowledge-bases"],
    ["USE1-Rerank-Requests", "knowledge-bases"],
    ["USE1-AgentCore-Runtime", "agents"],
    ["USE1-Agent-Invocation", "agents"],
    ["USE1-Agents-Invocation", "agents"],
    ["USE1-Flow-Executions", "flows"],
    ["USE1-NodeTransition", "flows"],
    ["USE1-DataAutomation-Pages", "data-automation"],
    ["USE1-ModelEvaluation-Tokens", "model-evaluation"],
    ["USE1-HumanTask", "model-evaluation"],
    ["USE1-PromptRouting-Requests", "other-features"],
    ["USE1-PromptOptimization-Tokens", "other-features"],
    ["USE1-WebSearch-Queries", "other-features"],
  ] as const)("%s -> nonModel.%s", (raw, category) => {
    expect(classifyUsageType(raw)).toEqual(nonModel(category));
  });

  it("matches case-insensitively as a substring", () => {
    expect(classifyUsageType("USE1-GUARDRAIL-textunits")).toEqual(
      nonModel("guardrails"),
    );
    expect(classifyUsageType("use1-provisionedthroughput-x")).toEqual(
      nonModel("provisioned-throughput"),
    );
    expect(classifyUsageType("USE1-Some_KnowledgeBase_Thing")).toEqual(
      nonModel("knowledge-bases"),
    );
  });

  it("reaches every category except unclassified", () => {
    const reached = new Set<string>();
    for (const raw of [
      "Guardrail",
      "CustomModelUnit",
      "CustomModelStorage",
      "ProvisionedThroughput",
      "FineTuning",
      "KnowledgeBase",
      "AgentCore",
      "NodeTransition",
      "DataAutomation",
      "Evaluation",
      "PromptRouting",
    ]) {
      const r = classifyUsageType(`USE1-${raw}`);
      if (r.kind === "nonModel") reached.add(r.category);
    }
    expect([...reached].sort()).toEqual(
      NON_MODEL_CATEGORIES.filter((c) => c !== "unclassified").sort(),
    );
  });
});

describe("classifyUsageType — non-model beats the model it names (Rule 2)", () => {
  it.each(["ClaudeOpus", "ClaudeSonnet", "ClaudeHaiku"])(
    "a Provisioned Throughput usage type naming %s -> provisioned-throughput, not the model",
    (family) => {
      expect(
        classifyUsageType(`USE1-ProvisionedThroughput-${family}-1Month`),
      ).toEqual(nonModel("provisioned-throughput"));
      expect(classifyUsageType(`USE1-${family}-ModelUnit-NoCommit`)).toEqual(
        nonModel("provisioned-throughput"),
      );
    },
  );

  it("guardrail, storage, customization, and evaluation usage types naming a model stay non-model", () => {
    expect(classifyUsageType("USE1-Guardrail-ClaudeSonnet")).toEqual(
      nonModel("guardrails"),
    );
    expect(classifyUsageType("USE1-CustomModelStorage-ClaudeHaiku")).toEqual(
      nonModel("custom-model-storage"),
    );
    expect(
      classifyUsageType("USE1-Customization-ClaudeHaiku-Training"),
    ).toEqual(nonModel("model-customization"));
    expect(classifyUsageType("USE1-ModelEvaluation-ClaudeOpus")).toEqual(
      nonModel("model-evaluation"),
    );
  });
});

describe("classifyUsageType — ordering (first match wins)", () => {
  it("a …CustomModelUnit… usage type -> custom-model-import, not provisioned-throughput", () => {
    // `ModelUnit` (PT marker) is a substring of `CustomModelUnit`.
    expect(classifyUsageType("USE1-CustomModelUnit-Minutes")).toEqual(
      nonModel("custom-model-import"),
    );
    expect(
      classifyUsageType("USE1-ClaudeSonnet-CustomModelUnit-Minutes"),
    ).toEqual(nonModel("custom-model-import"));
    expect(
      classifyUsageType("USE1-CustomModelUnit-ProvisionedThroughput"),
    ).toEqual(nonModel("custom-model-import"));
  });

  it("custom-model import is tested before custom-model storage", () => {
    expect(
      classifyUsageType("USE1-CustomModelUnit-CustomModelStorage"),
    ).toEqual(nonModel("custom-model-import"));
    expect(classifyUsageType("USE1-ModelImport-CustomModelStorage")).toEqual(
      nonModel("custom-model-import"),
    );
  });

  // One marker per table row, in spec order. For every adjacent pair, the
  // earlier row must win regardless of which marker appears first in the string.
  const ROWS = [
    ["Guardrail", nonModel("guardrails")],
    ["CustomModelUnit", nonModel("custom-model-import")],
    ["CustomModelStorage", nonModel("custom-model-storage")],
    ["ProvisionedThroughput", nonModel("provisioned-throughput")],
    ["FineTuning", nonModel("model-customization")],
    ["KnowledgeBase", nonModel("knowledge-bases")],
    ["AgentCore", nonModel("agents")],
    ["NodeTransition", nonModel("flows")],
    ["DataAutomation", nonModel("data-automation")],
    ["Evaluation", nonModel("model-evaluation")],
    ["PromptRouting", nonModel("other-features")],
    ["ClaudeOpus", model("claude-opus")],
  ] as const;

  const ADJACENT_PAIRS = ROWS.flatMap((earlier, i) => {
    const later = ROWS.slice(i + 1, i + 2);
    return later.map((l) => [earlier[0], earlier[1], l[0]] as const);
  });

  it.each(ADJACENT_PAIRS)(
    "%s outranks the next-lower row marker %s",
    (earlierMarker, earlierResult, laterMarker) => {
      expect(classifyUsageType(`USE1-${earlierMarker}-${laterMarker}`)).toEqual(
        earlierResult,
      );
      expect(classifyUsageType(`USE1-${laterMarker}-${earlierMarker}`)).toEqual(
        earlierResult,
      );
    },
  );

  it("every non-model row beats every later row, not only the adjacent one", () => {
    ROWS.forEach(([earlierMarker, earlierResult], i) => {
      for (const [laterMarker] of ROWS.slice(i + 1)) {
        expect(
          classifyUsageType(`USE1-${laterMarker}-${earlierMarker}`),
        ).toEqual(earlierResult);
      }
    });
  });
});

describe("classifyUsageType — Data Automation `BDA` is a whole token (row 9)", () => {
  it.each([
    "USE1-DataAutomation-Pages",
    "USE1-BDA-Pages",
    "EUC1-BDA-Pages",
    "BDA-Pages",
    "Pages-BDA",
    "USE1-Image-BDA",
    "USE1-Image_BDA_Pages",
    "USE1-Region:BDA:Pages",
    "BDA",
  ])("%s -> data-automation", (raw) => {
    expect(classifyUsageType(raw)).toEqual(nonModel("data-automation"));
  });

  it.each([
    "USE1-Lambda-GB-Seconds",
    "USE1-LambdaDuration",
    "USE1-Lambda",
    "USE1-BDAPages",
    "USE1-XBDA-Pages",
    "USE1-Abdan-Units",
  ])("%s is NOT data-automation", (raw) => {
    expect(classifyUsageType(raw)).not.toEqual(nonModel("data-automation"));
  });

  it("a usage type containing Lambda and no other marker is unclassified", () => {
    expect(classifyUsageType("USE1-Lambda-GB-Seconds")).toEqual(UNCLASSIFIED);
  });
});

describe("classifyUsageType — model families (row 12)", () => {
  it.each([
    ["ClaudeOpus", "claude-opus"],
    ["claude-opus", "claude-opus"],
    ["Claude4-Opus", "claude-opus"],
    ["ClaudeSonnet", "claude-sonnet"],
    ["Claude3-5-Sonnet", "claude-sonnet"],
    ["claude-sonnet", "claude-sonnet"],
    ["ClaudeHaiku", "claude-haiku"],
    ["Claude3-5-Haiku", "claude-haiku"],
    ["claude-haiku", "claude-haiku"],
  ] as const)("token usage of %s -> model %s", (family, key) => {
    expect(classifyUsageType(`USE1-${family}-input-tokens`)).toEqual(
      model(key),
    );
    expect(classifyUsageType(`USE1-${family}-output-tokens`)).toEqual(
      model(key),
    );
  });

  it.each([
    "USE1-Claude3-5-Sonnet-input-tokens",
    "EUC1-Claude4-Opus-output-tokens",
    "USE1-Claude3-5-Haiku-input-tokens",
  ])(
    "a Claude family token usage type is a model, never agents/flows: %s",
    (raw) => {
      const result = classifyUsageType(raw);
      expect(result.kind).toBe("model");
      expect(result.kind === "model" ? result.key : null).toMatch(/^claude-/);
    },
  );

  it("matches the family case-insensitively", () => {
    expect(classifyUsageType("USE1-ClAuDeOpUs-Input-Tokens")).toEqual(
      model("claude-opus"),
    );
  });

  it("derives every non-`other` family from models.ts MODEL_KEYS", () => {
    for (const key of MODEL_KEYS.filter((k) => k !== "other")) {
      expect(classifyUsageType(`USE1-${key}-input-tokens`)).toEqual(model(key));
    }
  });

  it.each([
    "USE1-ClaudeSonnet-Batch-input-tokens",
    "USE1-ClaudeSonnet-CacheRead-input-tokens",
    "USE1-ClaudeSonnet-CacheWrite-input-tokens",
    "USE1-ClaudeSonnet-CrossRegion-output-tokens",
    "USE1-ClaudeSonnet-Priority-input-tokens",
    "USE1-ClaudeSonnet-Flex-output-tokens",
  ])("pricing-variant token usage stays model cost: %s", (raw) => {
    expect(classifyUsageType(raw)).toEqual(model("claude-sonnet"));
  });

  it("a model-family usage type without a token marker is still model cost (row 12 needs only the family)", () => {
    expect(classifyUsageType("USE1-ClaudeHaiku-Something")).toEqual(
      model("claude-haiku"),
    );
  });
});

describe("classifyUsageType — models.other (row 13)", () => {
  it.each([
    "USE1-NovaPro-input-tokens",
    "USE1-Llama3-output-tokens",
    "USE1-MistralLarge-InputTokenCount",
    "USE1-ClaudeInstant-input-tokens",
  ])("token usage with no known family: %s -> model other", (raw) => {
    expect(classifyUsageType(raw)).toEqual(model("other"));
  });

  it.each(["input-tokens", "output-tokens", "InputToken"])(
    "token marker %s alone -> model other",
    (marker) => {
      expect(classifyUsageType(`USE1-Unknown-${marker}`)).toEqual(
        model("other"),
      );
    },
  );

  it("a token marker does not override an earlier non-model row", () => {
    expect(classifyUsageType("USE1-Guardrail-input-tokens")).toEqual(
      nonModel("guardrails"),
    );
  });
});

describe("classifyUsageType — unclassified (row 14)", () => {
  it.each([
    "USE1-Mystery",
    "USE1-DataTransfer-Out-Bytes",
    "USE1-Lambda-GB-Seconds",
    "SomethingElseEntirely",
    "USE1-",
    "",
  ])("%j -> unclassified (never guessed into a model)", (raw) => {
    expect(classifyUsageType(raw)).toEqual(UNCLASSIFIED);
  });
});

// Spec row 13 token markers are illustrative; input and output usage for an
// unmapped model must classify the same way (review R3-7).
describe("classifyUsageType — token-marker symmetry (row 13)", () => {
  it.each([
    "USE1-NovaPro-InputTokenCount",
    "USE1-NovaPro-OutputTokenCount",
    "USE1-Llama3-OutputTokenCount",
  ])("%s -> model other", (raw) => {
    expect(classifyUsageType(raw)).toEqual(model("other"));
  });
});

describe("classifyUsageType — family false matches (row 12)", () => {
  it.each(["USE1-MagnumOpus-Units", "USE1-Haiku-Poems"])(
    "%s is not classified as a Claude family model",
    (raw) => {
      expect(classifyUsageType(raw)).not.toEqual(model("claude-opus"));
      expect(classifyUsageType(raw)).not.toEqual(model("claude-haiku"));
      expect(classifyUsageType(raw)).not.toEqual(model("claude-sonnet"));
    },
  );
});

describe("classifyUsageType — performance guard", () => {
  it("classifies a 200k-char run of `custommodel` in well under 200 ms", () => {
    const adversarial = "custommodel".repeat(Math.ceil(200_000 / 11));
    const start = performance.now();
    classifyUsageType(adversarial);
    expect(performance.now() - start).toBeLessThan(200);
  });
});
