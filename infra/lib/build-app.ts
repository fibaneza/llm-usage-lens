import type { App } from "aws-cdk-lib";
import { COLLECTOR_REGION } from "@llm-usage-lens/shared";

import { AppStack } from "./app-stack";
import { InfraStack } from "./infra-stack";
import { parseAppInputs } from "./inputs";

// Source: docs/specs/2026-11-10-platform.md — "IaC layout", "Region". The
// AppStack reads InfraStack values only through SSM parameter names (no
// CloudFormation exports); the explicit dependency fixes the deploy order.
export function buildApp(
  app: App,
  context: Record<string, unknown>,
): { infra: InfraStack; app: AppStack } {
  const inputs = parseAppInputs(context);
  const env = { account: inputs.account, region: COLLECTOR_REGION };
  const infra = new InfraStack(app, `LlmUsageLens-${inputs.env}-Infra`, {
    stackName: `LlmUsageLens-${inputs.env}-Infra`,
    appEnv: inputs.env,
    env,
  });
  const appStack = new AppStack(app, `LlmUsageLens-${inputs.env}-App`, {
    stackName: `LlmUsageLens-${inputs.env}-App`,
    inputs,
    env,
  });
  appStack.addStackDependency(infra);
  return { infra, app: appStack };
}
