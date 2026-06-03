import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getInferenceProfileArn,
  getSimUserRoleArn,
  SERVICE_KEYS,
  USER_KEYS,
} from "../src/profiles.js";

const ENV_VARS = [
  "INFERENCE_PROFILE_CHAT_ARN",
  "INFERENCE_PROFILE_SUMMARIZER_ARN",
  "INFERENCE_PROFILE_TRANSLATOR_ARN",
  "SIM_USER_ROLE_ENGINEERING_ARN",
  "SIM_USER_ROLE_RESEARCH_ARN",
  "SIM_USER_ROLE_MARKETING_ARN",
] as const;

const snapshot = (): Record<string, string | undefined> => {
  const out: Record<string, string | undefined> = {};
  for (const v of ENV_VARS) out[v] = process.env[v];
  return out;
};

const restore = (snap: Record<string, string | undefined>): void => {
  for (const v of ENV_VARS) {
    const prior = snap[v];
    if (prior === undefined) {
      delete process.env[v];
    } else {
      process.env[v] = prior;
    }
  }
};

describe("profiles.ts service resolution", () => {
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = snapshot();
  });
  afterEach(() => {
    restore(saved);
  });

  it("each service key resolves to its env-var ARN", () => {
    process.env["INFERENCE_PROFILE_CHAT_ARN"] = "arn:aws:bedrock:us-east-1:1:inference-profile/chat";
    process.env["INFERENCE_PROFILE_SUMMARIZER_ARN"] =
      "arn:aws:bedrock:us-east-1:1:inference-profile/summarizer";
    process.env["INFERENCE_PROFILE_TRANSLATOR_ARN"] =
      "arn:aws:bedrock:us-east-1:1:inference-profile/translator";

    expect(getInferenceProfileArn("chat")).toBe(
      "arn:aws:bedrock:us-east-1:1:inference-profile/chat",
    );
    expect(getInferenceProfileArn("summarizer")).toBe(
      "arn:aws:bedrock:us-east-1:1:inference-profile/summarizer",
    );
    expect(getInferenceProfileArn("translator")).toBe(
      "arn:aws:bedrock:us-east-1:1:inference-profile/translator",
    );
  });

  it("throws a clear error naming the missing inference-profile env var", () => {
    delete process.env["INFERENCE_PROFILE_CHAT_ARN"];
    expect(() => getInferenceProfileArn("chat")).toThrowError(
      /INFERENCE_PROFILE_CHAT_ARN/,
    );
  });

  it("throws when an inference-profile env var is the empty string", () => {
    process.env["INFERENCE_PROFILE_SUMMARIZER_ARN"] = "";
    expect(() => getInferenceProfileArn("summarizer")).toThrowError(
      /INFERENCE_PROFILE_SUMMARIZER_ARN/,
    );
  });

  it("SERVICE_KEYS lists exactly the three documented services", () => {
    expect([...SERVICE_KEYS].sort()).toEqual(
      ["chat", "summarizer", "translator"].sort(),
    );
  });
});

describe("profiles.ts user resolution", () => {
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = snapshot();
  });
  afterEach(() => {
    restore(saved);
  });

  it("each user key resolves to its env-var SimUserRole ARN", () => {
    process.env["SIM_USER_ROLE_ENGINEERING_ARN"] =
      "arn:aws:iam::111111111111:role/SimUserRole-engineering";
    process.env["SIM_USER_ROLE_RESEARCH_ARN"] =
      "arn:aws:iam::111111111111:role/SimUserRole-research";
    process.env["SIM_USER_ROLE_MARKETING_ARN"] =
      "arn:aws:iam::111111111111:role/SimUserRole-marketing";

    expect(getSimUserRoleArn("engineering")).toBe(
      "arn:aws:iam::111111111111:role/SimUserRole-engineering",
    );
    expect(getSimUserRoleArn("research")).toBe(
      "arn:aws:iam::111111111111:role/SimUserRole-research",
    );
    expect(getSimUserRoleArn("marketing")).toBe(
      "arn:aws:iam::111111111111:role/SimUserRole-marketing",
    );
  });

  it("throws a clear error naming the missing SimUserRole env var", () => {
    delete process.env["SIM_USER_ROLE_RESEARCH_ARN"];
    expect(() => getSimUserRoleArn("research")).toThrowError(
      /SIM_USER_ROLE_RESEARCH_ARN/,
    );
  });

  it("throws when a SimUserRole env var is empty", () => {
    process.env["SIM_USER_ROLE_MARKETING_ARN"] = "";
    expect(() => getSimUserRoleArn("marketing")).toThrowError(
      /SIM_USER_ROLE_MARKETING_ARN/,
    );
  });

  it("USER_KEYS lists exactly the three documented users", () => {
    expect([...USER_KEYS].sort()).toEqual(
      ["engineering", "marketing", "research"].sort(),
    );
  });
});
