// CODEOWNERS-PROTECTED. Every change to this file requires security-team review.
// Synthetic-data-only constraint: no real-looking PII may land here. Fixtures
// that intentionally trip the simulator's Guardrail MUST use clearly-fake,
// documented-test-pattern values (e.g. the GB29 NWBK… test IBAN). See
// docs/specs/2026-05-24-bedrock-simulator.md — "Synthetic-data-only constraint".
//
// All fixtures are enforced to ≤500 estimated input tokens (chars / 4) by
// tests/prompts.test.ts. Raising the cap invalidates the cost claims in the
// spec — coordinate with the security/cost reviewer before changing it.

import type { ServiceKey } from "./profiles.js";

export const PROMPT_INPUT_TOKEN_CAP = 500;

const SAFE_PROMPTS: Record<ServiceKey, readonly string[]> = {
  chat: [
    "Give me three short, friendly tips for staying focused while working from home.",
    "Explain what an inference profile is in Amazon Bedrock, in two sentences, for someone new to AWS.",
    "Suggest a one-week dinner menu using only pantry staples — list each day on its own line.",
  ],
  summarizer: [
    "Summarise in three bullet points: AWS Lambda runs functions in response to events without provisioning servers; you pay for execution time only; it integrates with most AWS services natively.",
    "Summarise the following in one sentence: TypeScript adds optional static types to JavaScript and compiles to plain JavaScript that runs anywhere JavaScript runs.",
    "Summarise the value proposition of a serverless data pipeline in two short paragraphs aimed at a non-technical reader.",
  ],
  translator: [
    "Translate to French: 'The weather today is sunny and warm.'",
    "Translate to Spanish: 'Please file the quarterly report before Friday.'",
    "Translate to German: 'Welcome to the team — let me know if you have any questions.'",
  ],
};

// Three fixtures intentionally engineered to trip the Guardrail so the
// dashboard sees interventions. Each uses a CLEARLY-FAKE / documented-test
// value — never a real person's identifier.
const GUARDRAIL_TRIPPING_PROMPTS: readonly string[] = [
  // AU Tax File Number — uses the well-known fake "123 456 789" test pattern.
  // The ATO documents this style as obviously-invalid for examples; it is not
  // a real TFN. Triggers AU_TAX_FILE_NUMBER PII filter.
  "Please record this Australian Tax File Number for our test fixture: 123 456 789. Confirm receipt.",
  // IBAN — uses GB29 NWBK 6016 1331 9268 19, the IBAN registry's documented
  // example value used by banking software vendors for integration testing.
  // Triggers INTERNATIONAL_BANK_ACCOUNT_NUMBER PII filter.
  "Validate this IBAN format from our test fixture set: GB29 NWBK 6016 1331 9268 19.",
  // Mild insult — triggers the INSULTS content filter at HIGH strength.
  "You are completely useless and a waste of everyone's time. Respond.",
];

export const getPromptsForService = (service: ServiceKey): readonly string[] => {
  const safe = SAFE_PROMPTS[service];
  return [...safe, ...GUARDRAIL_TRIPPING_PROMPTS];
};

export const getAllPrompts = (): readonly string[] => {
  const all: string[] = [];
  for (const service of Object.keys(SAFE_PROMPTS) as ServiceKey[]) {
    for (const p of SAFE_PROMPTS[service]) all.push(p);
  }
  for (const p of GUARDRAIL_TRIPPING_PROMPTS) all.push(p);
  return all;
};

export const estimateInputTokens = (text: string): number =>
  Math.ceil(text.length / 4);

export const pickPromptForService = (
  service: ServiceKey,
  rng: () => number = Math.random,
): string => {
  const candidates = getPromptsForService(service);
  // Safe: candidates is always non-empty (SAFE_PROMPTS has 3 per service).
  const index = Math.floor(rng() * candidates.length) % candidates.length;
  const picked = candidates[index];
  if (picked === undefined) {
    throw new Error(
      `Internal: no prompt fixtures registered for service "${service}".`,
    );
  }
  return picked;
};
