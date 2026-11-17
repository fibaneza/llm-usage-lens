// @vitest-environment node
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

// Source: docs/specs/2026-11-10-platform.md - Base path: BP-D4 (the ALB does not
// strip the prefix; rule conditions are <prefix> and <prefix>/*, never
// <prefix>*), BP-D5 (every health check follows the prefix), BP-D6 (the image
// is built per prefix, default /llm-lens, overridable, empty allowed), BP-D7
// (two POC load-balancer modes, never both; rule mode creates one listener
// rule and the target group, no listener, no certificate), BP-D9 (AUTH_URL
// origin-only). Test T13 of the BP brief. The POC is not a Vitest workspace, so
// its tests live here: the CloudFormation template is parsed and its Rules,
// Conditions and intrinsic functions evaluated for a parameter set (no cfn-lint
// is installed); the scripts run against stub `aws` and `docker` binaries on
// PATH that log their arguments. No real AWS or Docker is touched.
const ROOT = join(__dirname, "..");
const POC = join(ROOT, "poc");
const LISTENER_ARN =
  "arn:aws:elasticloadbalancing:ap-southeast-2:123456789012:listener/app/shared/0123456789abcdef/0123456789abcdef";
const ALB_ARN =
  "arn:aws:elasticloadbalancing:ap-southeast-2:123456789012:loadbalancer/app/shared/0123456789abcdef";
const CERT_ARN =
  "arn:aws:acm:ap-southeast-2:123456789012:certificate/01234567-89ab-cdef-0123-456789abcdef";

// --- CloudFormation evaluator ------------------------------------------------

type Json = Record<string, unknown>;
type Param = string | number;
const NO_VALUE = Symbol("AWS::NoValue");

const requireFromDashboard = createRequire(
  join(ROOT, "apps/dashboard/package.json"),
);
const { parse } = requireFromDashboard("yaml") as {
  parse: (text: string, options?: unknown) => unknown;
};

function tags() {
  const names = [
    "Ref",
    "Sub",
    "GetAtt",
    "If",
    "Equals",
    "Not",
    "And",
    "Or",
    "Condition",
    "Join",
    "Select",
    "FindInMap",
    "Base64",
  ];
  return names.flatMap((name) => {
    const key = name === "Ref" || name === "Condition" ? name : `Fn::${name}`;
    return [
      { tag: `!${name}`, resolve: (str: string) => ({ [key]: str }) },
      {
        tag: `!${name}`,
        collection: "seq" as const,
        resolve: (seq: { toJSON: () => unknown }) => ({ [key]: seq.toJSON() }),
      },
    ];
  });
}

const template = parse(readFileSync(join(POC, "cloudformation.yml"), "utf8"), {
  customTags: tags() as never,
}) as {
  Parameters: Record<string, Json>;
  Rules: Record<string, { RuleCondition?: unknown; Assertions: Json[] }>;
  Conditions: Record<string, unknown>;
  Resources: Record<string, { Type: string; Condition?: string } & Json>;
};

function ctxFor(overrides: Record<string, Param>) {
  const params: Record<string, Param> = {};
  for (const [name, def] of Object.entries(template.Parameters)) {
    if (def.Default !== undefined) params[name] = def.Default as Param;
  }
  Object.assign(params, overrides);
  return params;
}

function evaluate(node: unknown, params: Record<string, Param>): unknown {
  if (Array.isArray(node)) {
    return node.map((n) => evaluate(n, params)).filter((v) => v !== NO_VALUE);
  }
  if (node === null || typeof node !== "object") return node;
  const obj = node as Json;
  const keys = Object.keys(obj);
  if (keys.length === 1) {
    const key = keys[0] as string;
    const arg = obj[key];
    switch (key) {
      case "Ref": {
        const name = String(arg);
        if (name === "AWS::NoValue") return NO_VALUE;
        return name in params ? params[name] : { Ref: name };
      }
      case "Condition":
        return evaluate(template.Conditions[String(arg)], params);
      case "Fn::Equals": {
        const [a, b] = (arg as unknown[]).map((x) => evaluate(x, params));
        return String(a) === String(b);
      }
      case "Fn::Not":
        return !(evaluate((arg as unknown[])[0], params) as boolean);
      case "Fn::And":
        return (arg as unknown[]).every((x) => evaluate(x, params) === true);
      case "Fn::Or":
        return (arg as unknown[]).some((x) => evaluate(x, params) === true);
      case "Fn::If": {
        const [c, yes, no] = arg as unknown[];
        const name = String(c);
        return evaluate(
          evaluate({ Condition: name }, params) ? yes : no,
          params,
        );
      }
      case "Fn::Join": {
        const [sep, parts] = arg as [string, unknown[]];
        return parts.map((p) => String(evaluate(p, params))).join(sep);
      }
      case "Fn::Sub":
        return String(arg).replace(/\$\{([A-Za-z0-9]+)\}/g, (m, n: string) =>
          n in params ? String(params[n]) : m,
        );
      default:
        break;
    }
  }
  const out: Json = {};
  for (const [k, v] of Object.entries(obj)) {
    const value = evaluate(v, params);
    if (value !== NO_VALUE) out[k] = value;
  }
  return out;
}

// What CloudFormation would do for these parameters: failed Rules, parameter
// constraint violations, and the resources that exist with their properties.
function deploy(overrides: Record<string, Param>) {
  const params = ctxFor(overrides);
  const violations: string[] = [];
  for (const [name, def] of Object.entries(template.Parameters)) {
    const value = params[name];
    if (value === undefined) {
      violations.push(`${name}: missing`);
      continue;
    }
    if (typeof def.AllowedPattern === "string") {
      if (!new RegExp(`^(?:${def.AllowedPattern})$`).test(String(value))) {
        violations.push(`${name}: pattern`);
      }
    }
    if (typeof def.MinValue === "number" && Number(value) < def.MinValue) {
      violations.push(`${name}: min`);
    }
    if (typeof def.MaxValue === "number" && Number(value) > def.MaxValue) {
      violations.push(`${name}: max`);
    }
  }
  for (const [name, rule] of Object.entries(template.Rules ?? {})) {
    if (
      rule.RuleCondition !== undefined &&
      evaluate(rule.RuleCondition, params) !== true
    ) {
      continue;
    }
    for (const assertion of rule.Assertions) {
      if (evaluate(assertion.Assert, params) !== true) {
        violations.push(`rule ${name}`);
      }
    }
  }
  const resources: Record<string, { Type: string; Properties: Json }> = {};
  for (const [name, res] of Object.entries(template.Resources)) {
    if (
      res.Condition &&
      evaluate({ Condition: res.Condition }, params) !== true
    )
      continue;
    resources[name] = {
      Type: res.Type,
      Properties: evaluate(res.Properties ?? {}, params) as Json,
    };
  }
  return { violations, resources };
}

const REQUIRED = {
  VpcId: "vpc-0123456789abcdef0",
  SubnetId: "subnet-0123456789abcdef0",
};
const RULE_MODE = {
  ...REQUIRED,
  ExistingAlbArn: ALB_ARN,
  ExistingAlbListenerArn: LISTENER_ARN,
  AlbRulePriority: 100,
  BasePath: "/llm-lens",
};
const LISTENER_MODE = { ...REQUIRED, ExistingAlbArn: ALB_ARN };

const typesOf = (
  resources: Record<string, { Type: string; Properties: Json }>,
  type: string,
) => Object.entries(resources).filter(([, r]) => r.Type === type);

// --- Template -----------------------------------------------------------------

describe("poc/cloudformation.yml rule mode (BP-D4, BP-D7)", () => {
  it("is valid with the rule-mode parameters", () => {
    expect(deploy(RULE_MODE).violations).toEqual([]);
  });

  it("creates one listener rule with both path patterns, the priority, the listener and the target group", () => {
    const { resources } = deploy(RULE_MODE);
    const rules = typesOf(
      resources,
      "AWS::ElasticLoadBalancingV2::ListenerRule",
    );
    expect(rules).toHaveLength(1);
    const props = rules[0]?.[1].Properties as Json;
    expect(props.ListenerArn).toBe(LISTENER_ARN);
    expect(Number(props.Priority)).toBe(100);
    const conditions = props.Conditions as {
      Field?: string;
      PathPatternConfig?: { Values: string[] };
      Values?: string[];
    }[];
    const patterns = conditions
      .filter((c) => c.Field === "path-pattern")
      .flatMap((c) => c.PathPatternConfig?.Values ?? c.Values ?? []);
    // BP-D4: exactly these two, never "/llm-lens*" (it would match /llm-lens-other).
    expect([...patterns].sort()).toEqual(["/llm-lens", "/llm-lens/*"]);
    const actions = props.Actions as { Type: string }[];
    expect(actions[0]?.Type).toBe("forward");
    expect(JSON.stringify(actions)).toContain("AlbTargetGroup");
  });

  it("creates no listener and no listener certificate (BP-D7)", () => {
    const { resources } = deploy(RULE_MODE);
    expect(typesOf(resources, "AWS::ElasticLoadBalancingV2::Listener")).toEqual(
      [],
    );
    expect(
      typesOf(resources, "AWS::ElasticLoadBalancingV2::ListenerCertificate"),
    ).toEqual([]);
  });

  it("keeps the target group and the POC security group, so alb-security-group.sh still works", () => {
    const { resources } = deploy(RULE_MODE);
    expect(
      typesOf(resources, "AWS::ElasticLoadBalancingV2::TargetGroup"),
    ).toHaveLength(1);
    expect(resources.AlbSecurityGroup).toBeDefined();
    expect(resources.AlbToInstanceIngress).toBeDefined();
  });

  it("health-checks <prefix>/api/health (BP-D5)", () => {
    const { resources } = deploy(RULE_MODE);
    expect(resources.AlbTargetGroup?.Properties.HealthCheckPath).toBe(
      "/llm-lens/api/health",
    );
  });

  it("does not add a listener-port ingress rule in rule mode", () => {
    const { resources } = deploy({
      ...RULE_MODE,
      AlbAllowedInboundCidr: "203.0.113.0/24",
    });
    expect(resources.AlbListenerIngress).toBeUndefined();
  });
});

describe("poc/cloudformation.yml refuses a mix of the two modes (BP-D7)", () => {
  it("refuses a rule together with a listener certificate", () => {
    const { violations } = deploy({
      ...RULE_MODE,
      AlbCertificateArn: CERT_ARN,
    });
    expect(violations.length).toBeGreaterThan(0);
  });

  it("refuses rule mode without a base path (the rule would match everything)", () => {
    const { violations } = deploy({ ...RULE_MODE, BasePath: "" });
    expect(violations.length).toBeGreaterThan(0);
  });

  it("refuses a listener ARN without the load balancer ARN", () => {
    const { violations } = deploy({ ...RULE_MODE, ExistingAlbArn: "" });
    expect(violations.length).toBeGreaterThan(0);
  });
});

describe("poc/cloudformation.yml listener mode stays (BP-D7, BP-D1)", () => {
  it("creates the listener and no listener rule", () => {
    const { resources, violations } = deploy(LISTENER_MODE);
    expect(violations).toEqual([]);
    expect(
      typesOf(resources, "AWS::ElasticLoadBalancingV2::Listener"),
    ).toHaveLength(1);
    expect(
      typesOf(resources, "AWS::ElasticLoadBalancingV2::ListenerRule"),
    ).toEqual([]);
  });

  it("health-checks /api/health with no base path, <prefix>/api/health with one (BP-D5)", () => {
    expect(
      deploy(LISTENER_MODE).resources.AlbTargetGroup?.Properties
        .HealthCheckPath,
    ).toBe("/api/health");
    expect(
      deploy({ ...LISTENER_MODE, BasePath: "/llm-lens" }).resources
        .AlbTargetGroup?.Properties.HealthCheckPath,
    ).toBe("/llm-lens/api/health");
  });

  it("creates no ALB resources without a load balancer", () => {
    const { resources } = deploy({ ...REQUIRED });
    expect(
      Object.values(resources).filter((r) =>
        r.Type.startsWith("AWS::ElasticLoadBalancingV2::"),
      ),
    ).toEqual([]);
  });
});

describe("poc/cloudformation.yml parameters (BP-D2, BP-D7)", () => {
  it.each(["", "/llm-lens", "/a/b-2"])("accepts BasePath %j", (value) => {
    expect(deploy({ ...RULE_MODE, BasePath: value }).violations).not.toContain(
      "BasePath: pattern",
    );
  });

  it.each(["llm-lens", "/llm-lens/", "/Llm", "//x", "/a b", "https://x/y"])(
    "rejects BasePath %j",
    (value) => {
      expect(deploy({ ...RULE_MODE, BasePath: value }).violations).toContain(
        "BasePath: pattern",
      );
    },
  );

  it.each([0, 50001])("rejects AlbRulePriority %j", (value) => {
    expect(
      deploy({ ...RULE_MODE, AlbRulePriority: value }).violations.length,
    ).toBeGreaterThan(0);
  });

  it("rejects a listener ARN that is not a listener ARN", () => {
    expect(
      deploy({ ...RULE_MODE, ExistingAlbListenerArn: ALB_ARN }).violations,
    ).toContain("ExistingAlbListenerArn: pattern");
  });
});

// --- Scripts, against stub aws and docker --------------------------------------

type Run = { status: number | null; stderr: string; calls: string[][] };

let stubDir = "";

function setupStubs() {
  stubDir = mkdtempSync(join(tmpdir(), "poc-stubs-"));
  const logger = (name: string, body: string) => {
    const file = join(stubDir, name);
    writeFileSync(
      file,
      `#!/bin/sh\nprintf '${name}' >> "$STUB_LOG"\nfor a in "$@"; do printf '\\t%s' "$a" >> "$STUB_LOG"; done\nprintf '\\n' >> "$STUB_LOG"\n${body}\nexit 0\n`,
    );
    chmodSync(file, 0o755);
  };
  logger(
    "aws",
    `case "$*" in
  *"sts get-caller-identity"*) echo 000000000000 ;;
  *"describe-stacks"*"StackName"*) [ -n "$STUB_STACK_EXISTS" ] || exit 255; echo stack ;;
  *"configure get region"*) echo ap-southeast-2 ;;
  *"get-login-password"*) echo password ;;
esac`,
  );
  logger("docker", `case "$1" in login) cat >/dev/null ;; esac`);
}

function run(
  script: string,
  args: string[],
  extra: Record<string, string> = {},
): Run {
  const log = join(stubDir, `log-${Math.random().toString(36).slice(2)}`);
  writeFileSync(log, "");
  const result = spawnSync("bash", [join(POC, "scripts", script), ...args], {
    env: {
      PATH: `${stubDir}:/usr/bin:/bin`,
      HOME: stubDir,
      STUB_LOG: log,
      AWS_REGION: "ap-southeast-2",
      ...extra,
    },
    encoding: "utf8",
  });
  const calls = readFileSync(log, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t"));
  return { status: result.status, stderr: result.stderr, calls };
}

beforeAll(setupStubs);

function configFile(lines: string[]): string {
  const file = join(
    stubDir,
    `stack-${Math.random().toString(36).slice(2)}.env`,
  );
  writeFileSync(file, `${lines.join("\n")}\n`);
  return file;
}

const deployCall = (r: Run) =>
  r.calls.find((c) => c[0] === "aws" && c.includes("deploy"));
const overridesOf = (r: Run): string[] => {
  const call = deployCall(r) ?? [];
  const i = call.indexOf("--parameter-overrides");
  return i < 0 ? [] : call.slice(i + 1);
};

describe("deploy-stack.sh rule mode (BP-D7)", () => {
  const base = ["--vpc-id", REQUIRED.VpcId, "--subnet-id", REQUIRED.SubnetId];

  it("passes the listener ARN, priority, base path and load balancer to the template", () => {
    const r = run("deploy-stack.sh", [
      "--config",
      configFile(["# empty"]),
      ...base,
      "--alb-arn",
      ALB_ARN,
      "--alb-listener-arn",
      LISTENER_ARN,
      "--alb-rule-priority",
      "100",
      "--base-path",
      "/llm-lens",
    ]);
    expect(r.status).toBe(0);
    expect(overridesOf(r)).toEqual(
      expect.arrayContaining([
        `ExistingAlbArn=${ALB_ARN}`,
        `ExistingAlbListenerArn=${LISTENER_ARN}`,
        "AlbRulePriority=100",
        "BasePath=/llm-lens",
      ]),
    );
  });

  it("loads the same keys from stack.env", () => {
    const r = run("deploy-stack.sh", [
      "--config",
      configFile([
        `VpcId=${REQUIRED.VpcId}`,
        `SubnetId=${REQUIRED.SubnetId}`,
        `ExistingAlbArn=${ALB_ARN}`,
        `ExistingAlbListenerArn=${LISTENER_ARN}`,
        "AlbRulePriority=100",
        "BasePath=/llm-lens",
      ]),
    ]);
    expect(r.status).toBe(0);
    expect(overridesOf(r)).toEqual(
      expect.arrayContaining([
        `ExistingAlbListenerArn=${LISTENER_ARN}`,
        "AlbRulePriority=100",
        "BasePath=/llm-lens",
      ]),
    );
  });

  it.each([
    ["--alb-certificate-arn", CERT_ARN],
    ["--alb-listener-port", "8443"],
  ])(
    "refuses %s together with --alb-listener-arn, before any deploy",
    (flag, value) => {
      const r = run("deploy-stack.sh", [
        "--config",
        configFile(["# empty"]),
        ...base,
        "--alb-arn",
        ALB_ARN,
        "--alb-listener-arn",
        LISTENER_ARN,
        "--alb-rule-priority",
        "100",
        "--base-path",
        "/llm-lens",
        flag,
        value,
      ]);
      expect(r.status).not.toBe(0);
      expect(deployCall(r)).toBeUndefined();
    },
  );

  it("refuses the same mix when it comes from stack.env", () => {
    const r = run("deploy-stack.sh", [
      "--config",
      configFile([
        `VpcId=${REQUIRED.VpcId}`,
        `SubnetId=${REQUIRED.SubnetId}`,
        `ExistingAlbArn=${ALB_ARN}`,
        `ExistingAlbListenerArn=${LISTENER_ARN}`,
        "AlbRulePriority=100",
        "BasePath=/llm-lens",
        `AlbCertificateArn=${CERT_ARN}`,
      ]),
    ]);
    expect(r.status).not.toBe(0);
    expect(deployCall(r)).toBeUndefined();
  });

  it("refuses a listener ARN without a rule priority on the first deploy", () => {
    const r = run("deploy-stack.sh", [
      "--config",
      configFile(["# empty"]),
      ...base,
      "--alb-arn",
      ALB_ARN,
      "--alb-listener-arn",
      LISTENER_ARN,
      "--base-path",
      "/llm-lens",
    ]);
    expect(r.status).not.toBe(0);
    expect(deployCall(r)).toBeUndefined();
  });

  it.each(["llm-lens", "/llm-lens/", "/Llm", "//x"])(
    "refuses the invalid --base-path %j (BP-D2) before any deploy",
    (value) => {
      const r = run("deploy-stack.sh", [
        "--config",
        configFile(["# empty"]),
        ...base,
        "--base-path",
        value,
      ]);
      expect(r.status).not.toBe(0);
      expect(deployCall(r)).toBeUndefined();
    },
  );

  it("refuses an <placeholder> in the new keys (existing stack.env contract)", () => {
    const r = run("deploy-stack.sh", [
      "--config",
      configFile([
        `VpcId=${REQUIRED.VpcId}`,
        `SubnetId=${REQUIRED.SubnetId}`,
        "ExistingAlbListenerArn=<listener-arn>",
      ]),
    ]);
    expect(r.status).not.toBe(0);
    expect(deployCall(r)).toBeUndefined();
  });

  it.each([
    "ExistingAlbListenerArn=arn:aws:elasticloadbalancing:ap-southeast-2:000000000000:listener/app/x/1/2",
    "ExistingAlbListenerArn=CHANGE_ME",
  ])("refuses the placeholder value %s (Rule 50.9)", (line) => {
    const r = run("deploy-stack.sh", [
      "--config",
      configFile([
        `VpcId=${REQUIRED.VpcId}`,
        `SubnetId=${REQUIRED.SubnetId}`,
        line,
      ]),
    ]);
    expect(r.status).not.toBe(0);
    expect(deployCall(r)).toBeUndefined();
  });

  it("still deploys listener mode unchanged (BP-D7)", () => {
    const r = run("deploy-stack.sh", [
      "--config",
      configFile(["# empty"]),
      ...base,
      "--alb-arn",
      ALB_ARN,
      "--alb-listener-port",
      "8443",
      "--alb-certificate-arn",
      CERT_ARN,
    ]);
    expect(r.status).toBe(0);
    expect(overridesOf(r)).toEqual(
      expect.arrayContaining([
        "AlbListenerPort=8443",
        `AlbCertificateArn=${CERT_ARN}`,
      ]),
    );
  });
});

describe("build-and-push.sh base path (BP-D6)", () => {
  const args = [
    "--region",
    "ap-southeast-2",
    "--platform",
    "linux/arm64",
    "--repository-uri",
    "000000000000.dkr.ecr.ap-southeast-2.amazonaws.com/llm-usage-lens-poc",
  ];
  const buildCall = (r: Run) =>
    r.calls.find(
      (c) => c[0] === "docker" && c[1] === "buildx" && c[2] === "build",
    );
  const buildArgs = (r: Run): string[] => {
    const call = buildCall(r) ?? [];
    return call.flatMap((a, i) => (call[i - 1] === "--build-arg" ? [a] : []));
  };

  it("defaults to the POC prefix /llm-lens", () => {
    const r = run("build-and-push.sh", args);
    expect(r.status).toBe(0);
    expect(buildArgs(r)).toContain("NEXT_PUBLIC_BASE_PATH=/llm-lens");
  });

  it("takes another prefix", () => {
    const r = run("build-and-push.sh", [...args, "--base-path", "/other-app"]);
    expect(r.status).toBe(0);
    expect(buildArgs(r)).toContain("NEXT_PUBLIC_BASE_PATH=/other-app");
  });

  it("allows an empty prefix, passed through as an empty build argument", () => {
    const r = run("build-and-push.sh", [...args, "--base-path", ""]);
    expect(r.status).toBe(0);
    expect(buildArgs(r)).toContain("NEXT_PUBLIC_BASE_PATH=");
  });

  it.each(["llm-lens", "/llm-lens/", "/Llm", "//x"])(
    "refuses the invalid prefix %j (BP-D2) before building",
    (value) => {
      const r = run("build-and-push.sh", [...args, "--base-path", value]);
      expect(r.status).not.toBe(0);
      expect(buildCall(r)).toBeUndefined();
    },
  );
});

describe("Dockerfile build argument (BP-D6)", () => {
  const dockerfile = readFileSync(
    join(ROOT, "apps/dashboard/Dockerfile"),
    "utf8",
  );

  it("declares ARG NEXT_PUBLIC_BASE_PATH with an empty default and exports it before the build", () => {
    expect(dockerfile).toMatch(/^ARG NEXT_PUBLIC_BASE_PATH=("")?\s*$/m);
    expect(dockerfile).toMatch(
      /NEXT_PUBLIC_BASE_PATH=\$\{?NEXT_PUBLIC_BASE_PATH\}?/,
    );
    const arg = dockerfile.indexOf("ARG NEXT_PUBLIC_BASE_PATH");
    const build = dockerfile.indexOf(
      "pnpm --filter @llm-usage-lens/dashboard build",
    );
    expect(arg).toBeGreaterThan(-1);
    expect(arg).toBeLessThan(build);
  });
});

describe("POC files follow the prefix (BP-D5, BP-D9)", () => {
  it("passes bash -n for the changed scripts", () => {
    for (const script of ["deploy-stack.sh", "build-and-push.sh"]) {
      const r = spawnSync("bash", ["-n", join(POC, "scripts", script)], {
        encoding: "utf8",
      });
      expect(r.status, `${script}: ${r.stderr}`).toBe(0);
    }
  });

  it("makes the Compose healthcheck follow the prefix", () => {
    const compose = readFileSync(join(POC, "docker-compose.yml"), "utf8");
    expect(compose).toMatch(
      /127\.0\.0\.1:3000\/llm-lens\/api\/health|127\.0\.0\.1:3000\$\{[A-Z_]*BASE_PATH[^}]*\}\/api\/health/,
    );
    expect(compose).not.toMatch(/127\.0\.0\.1:3000\/api\/health/);
  });

  it("keeps AUTH_URL origin-only and gives NEXT_PUBLIC_APP_URL the prefix in .env.example", () => {
    const env = readFileSync(join(POC, ".env.example"), "utf8");
    const value = (key: string) =>
      new RegExp(`^${key}=(\\S+)`, "m").exec(env)?.[1] ?? "";
    expect(new URL(value("AUTH_URL")).pathname).toBe("/");
    expect(new URL(value("NEXT_PUBLIC_APP_URL")).pathname).toBe("/llm-lens");
  });

  it("documents the new stack.env keys", () => {
    const example = readFileSync(join(POC, "stack.env.example"), "utf8");
    for (const key of [
      "ExistingAlbListenerArn",
      "AlbRulePriority",
      "BasePath",
    ]) {
      expect(example, key).toMatch(new RegExp(`^${key}=`, "m"));
    }
  });
});
