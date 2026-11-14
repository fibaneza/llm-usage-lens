import { z } from "zod";

// Source: docs/specs/2026-11-10-platform.md — "Inputs". Context is parsed
// fail-closed: any missing or invalid value throws before a stack is built.

export const AppEnvSchema = z.enum(["dev", "prod"]);
export type AppEnv = z.infer<typeof AppEnvSchema>;

export function ssmPrefix(env: AppEnv): string {
  return `/llm-usage-lens/${env}`;
}

const list = (min: number) =>
  z.preprocess(
    (v) =>
      typeof v === "string"
        ? v
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : v,
    z.array(z.string().min(1)).min(min),
  );

const CidrSchema = z.string().refine((c) => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(c);
  if (!m) return false;
  const octets = m.slice(1, 5).map(Number);
  const prefix = m[5] ?? "";
  // Prefix >= 8 keeps any "open to the world" range (including split halves) out.
  return (
    octets.every((o) => o <= 255) &&
    !prefix.startsWith("0") &&
    Number(prefix) >= 8 &&
    Number(prefix) <= 32
  );
}, "company CIDR must be an IPv4 CIDR block with a /8 to /32 prefix");

const PrioritySchema = z.preprocess(
  (v) => (typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v),
  z.number().int().min(1).max(50000),
);

const BaseSchema = z
  .object({
    env: AppEnvSchema,
    account: z.string().regex(/^\d{12}$/),
    vpcId: z.string().regex(/^vpc-[0-9a-f]+$/),
    availabilityZones: list(1),
    privateSubnetIds: list(2),
    certificateArn: z.string().startsWith("arn:aws:acm:"),
    dashboardHostname: z.string().min(1),
    alarmTopicArn: z.string().startsWith("arn:aws:sns:"),
    // Entra is an optional pair; both absent is Pre-SSO mode and needs the
    // master user (Access Control spec — "Pre-SSO mode").
    entraClientId: z.string().min(1).optional(),
    entraIssuer: z
      .url()
      .refine((u) => u.startsWith("https://"), "entraIssuer must be https")
      .optional(),
    githubRepository: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
    imageTag: z.string().min(1).default("latest"),
    // Optional break-glass master user name (Access Control spec — "Sign-in
    // methods"); the hash and TOTP secret are hand-managed SSM SecureStrings.
    masterUsername: z.string().min(1).max(64).optional(),
    // Platform spec — "Inputs": principals allowed past the table resource
    // policy, and the DynamoDB gateway endpoint the task role is bound to.
    opsRoleArn: z
      .string()
      .regex(/^arn:aws:iam::\d{12}:role\/.+/)
      .optional(),
    dynamodbVpcEndpointId: z
      .string()
      .regex(/^vpce-[0-9a-f]+$/)
      .optional(),
    // Platform spec — "Inputs": non-secret LiteLLM gateway host allowlist
    // (container environment LITELLM_ALLOWED_HOSTS); unset omits it.
    litellmAllowedHosts: z.string().min(1).optional(),
  })
  .superRefine((v, ctx) => {
    if ((v.entraClientId === undefined) !== (v.entraIssuer === undefined)) {
      ctx.addIssue({
        code: "custom",
        message:
          "entraClientId and entraIssuer must be set together or not at all",
      });
    }
    if (v.entraClientId === undefined && v.masterUsername === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "masterUsername is required when the Entra inputs are absent",
      });
    }
  });

const ImportSchema = z.object({
  listenerArn: z.string().startsWith("arn:aws:elasticloadbalancing:"),
  listenerRulePriority: PrioritySchema,
  albSecurityGroupId: z.string().regex(/^sg-[0-9a-f]+$/),
});

const CreateSchema = z.object({
  companyCidrs: list(1).pipe(z.array(CidrSchema)),
});

export type AppInputs = z.infer<typeof BaseSchema> & {
  loadBalancer:
    | {
        mode: "import";
        listenerArn: string;
        listenerRulePriority: number;
        albSecurityGroupId: string;
      }
    | { mode: "create"; companyCidrs: string[] };
};

export function parseAppInputs(context: Record<string, unknown>): AppInputs {
  const optionalKeys = [
    "entraClientId",
    "entraIssuer",
    "masterUsername",
    "opsRoleArn",
    "dynamodbVpcEndpointId",
    "litellmAllowedHosts",
  ];
  const cleaned = Object.fromEntries(
    Object.entries(context).filter(
      ([k, v]) => !(optionalKeys.includes(k) && v === ""),
    ),
  );
  const base = BaseSchema.parse(cleaned);
  if (base.availabilityZones.length !== base.privateSubnetIds.length) {
    throw new Error(
      "availabilityZones and privateSubnetIds must have the same length",
    );
  }
  const loadBalancer =
    context.listenerArn !== undefined
      ? ({ mode: "import", ...ImportSchema.parse(cleaned) } as const)
      : ({ mode: "create", ...CreateSchema.parse(cleaned) } as const);
  return { ...base, loadBalancer };
}
