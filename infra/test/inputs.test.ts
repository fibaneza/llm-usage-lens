// Source: docs/specs/2026-11-10-platform.md — "Inputs" (fail closed on missing
// or invalid context; import vs create ALB mode); contract rp-contract.md.
import { describe, expect, it } from "vitest";

import { AppEnvSchema, parseAppInputs, ssmPrefix } from "../lib/inputs";

import {
  ALB_SG,
  CERT_ARN,
  CIDR,
  ENTRA_ID,
  ENTRA_ISSUER,
  HOST,
  LISTENER_ARN,
  TOPIC_ARN,
  createContext,
  importContext,
} from "./support";

describe("AppEnvSchema / ssmPrefix", () => {
  it("accepts dev and prod only", () => {
    expect(AppEnvSchema.parse("dev")).toBe("dev");
    expect(AppEnvSchema.parse("prod")).toBe("prod");
    expect(AppEnvSchema.safeParse("staging").success).toBe(false);
  });

  it("builds the SSM prefix", () => {
    expect(ssmPrefix("dev")).toBe("/llm-usage-lens/dev");
    expect(ssmPrefix("prod")).toBe("/llm-usage-lens/prod");
  });
});

describe("parseAppInputs - import mode", () => {
  it("parses a valid context", () => {
    const inputs = parseAppInputs(importContext);
    expect(inputs).toMatchObject({
      env: "dev",
      account: "123456789012",
      vpcId: "vpc-00000000000000000",
      availabilityZones: ["ap-southeast-2a", "ap-southeast-2b"],
      privateSubnetIds: [
        "subnet-00000000000000001",
        "subnet-00000000000000002",
      ],
      certificateArn: CERT_ARN,
      dashboardHostname: HOST,
      alarmTopicArn: TOPIC_ARN,
      githubRepository: "example-org/llm-usage-lens",
      imageTag: "latest",
      loadBalancer: {
        mode: "import",
        listenerArn: LISTENER_ARN,
        listenerRulePriority: 100,
        albSecurityGroupId: ALB_SG,
      },
    });
  });

  it("accepts real arrays and a numeric priority", () => {
    const inputs = parseAppInputs({
      ...importContext,
      availabilityZones: ["ap-southeast-2a", "ap-southeast-2b"],
      privateSubnetIds: [
        "subnet-00000000000000001",
        "subnet-00000000000000002",
      ],
      listenerRulePriority: 7,
      imageTag: "abc123",
    });
    expect(inputs.imageTag).toBe("abc123");
    expect(inputs.loadBalancer).toMatchObject({ listenerRulePriority: 7 });
  });

  it("is import mode whenever listenerArn is present", () => {
    expect(parseAppInputs(importContext).loadBalancer.mode).toBe("import");
  });

  it.each(["albSecurityGroupId", "listenerRulePriority"])(
    "fails closed when %s is missing in import mode",
    (key) => {
      const ctx: Record<string, unknown> = { ...importContext };
      delete ctx[key];
      expect(() => parseAppInputs(ctx)).toThrow();
    },
  );

  it.each(["abc", "1.5", "0", "-3", ""])(
    "rejects non-numeric/invalid priority %j",
    (p) => {
      expect(() =>
        parseAppInputs({ ...importContext, listenerRulePriority: p }),
      ).toThrow();
    },
  );
});

describe("parseAppInputs - create mode", () => {
  it("parses a valid context", () => {
    const inputs = parseAppInputs(createContext);
    expect(inputs.loadBalancer).toEqual({
      mode: "create",
      companyCidrs: [CIDR],
    });
  });

  it("accepts a comma-separated CIDR list", () => {
    const inputs = parseAppInputs({
      ...createContext,
      companyCidrs: "10.0.0.0/8, 192.168.0.0/16",
    });
    expect(inputs.loadBalancer).toEqual({
      mode: "create",
      companyCidrs: ["10.0.0.0/8", "192.168.0.0/16"],
    });
  });

  it.each([
    ["missing", undefined],
    ["empty string", ""],
    ["empty array", []],
    ["open IPv4", "0.0.0.0/0"],
    ["open IPv4 among others", "10.0.0.0/8,0.0.0.0/0"],
    ["open IPv6", "::/0"],
    ["not a CIDR", "company"],
  ])("fails closed when companyCidrs is %s", (_n, value) => {
    const ctx: Record<string, unknown> = { ...createContext };
    if (value === undefined) delete ctx.companyCidrs;
    else ctx.companyCidrs = value;
    expect(() => parseAppInputs(ctx)).toThrow();
  });
});

describe("parseAppInputs - create mode CIDR validation", () => {
  it.each([
    "0.0.0.0/00",
    "999.1.1.1/24",
    "10.0.0.0/33",
    "10.0.0.0/-1",
    "10.0.0.0/08",
    "10.0.0.0/7",
    "0.0.0.0/1,128.0.0.0/1",
    "10.0.0.0/",
    "10.0.0/8",
  ])("rejects %j", (companyCidrs) => {
    expect(() => parseAppInputs({ ...createContext, companyCidrs })).toThrow();
  });

  it.each([["10.0.0.0/8"], ["192.168.1.0/24"], ["10.1.2.3/32"]])(
    "accepts %j",
    (companyCidrs) => {
      expect(
        parseAppInputs({ ...createContext, companyCidrs }).loadBalancer,
      ).toEqual({ mode: "create", companyCidrs: [companyCidrs] });
    },
  );
});

describe("parseAppInputs - fails closed", () => {
  it.each([
    "env",
    "account",
    "vpcId",
    "availabilityZones",
    "privateSubnetIds",
    "certificateArn",
    "dashboardHostname",
    "alarmTopicArn",
    "githubRepository",
    "entraClientId",
    "entraIssuer",
  ])("throws when %s is missing", (key) => {
    const ctx: Record<string, unknown> = { ...importContext };
    delete ctx[key];
    expect(() => parseAppInputs(ctx)).toThrow();
  });

  it("parses the Entra inputs", () => {
    expect(parseAppInputs(importContext)).toMatchObject({
      entraClientId: ENTRA_ID,
      entraIssuer: ENTRA_ISSUER,
    });
  });

  it.each(["http://login.microsoftonline.com/x/v2.0", "login.example", ""])(
    "rejects a non-https entraIssuer %j",
    (entraIssuer) => {
      expect(() => parseAppInputs({ ...importContext, entraIssuer })).toThrow();
    },
  );

  it("rejects an empty entraClientId", () => {
    expect(() =>
      parseAppInputs({ ...importContext, entraClientId: "" }),
    ).toThrow();
  });

  it("throws on an invalid env", () => {
    expect(() =>
      parseAppInputs({ ...importContext, env: "staging" }),
    ).toThrow();
  });

  it("throws on a non-12-digit account", () => {
    expect(() =>
      parseAppInputs({ ...importContext, account: "1234" }),
    ).toThrow();
  });

  it("throws when subnets and AZs differ in length", () => {
    expect(() =>
      parseAppInputs({
        ...importContext,
        availabilityZones: "ap-southeast-2a",
      }),
    ).toThrow();
  });

  it("throws with fewer than 2 subnets", () => {
    expect(() =>
      parseAppInputs({
        ...importContext,
        availabilityZones: "ap-southeast-2a",
        privateSubnetIds: "subnet-00000000000000001",
      }),
    ).toThrow();
  });

  it("throws on an empty context", () => {
    expect(() => parseAppInputs({})).toThrow();
  });
});
