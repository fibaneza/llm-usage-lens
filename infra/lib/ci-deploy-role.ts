import { Duration } from "aws-cdk-lib";
import type { Stack } from "aws-cdk-lib";
import type * as ecr from "aws-cdk-lib/aws-ecr";
import type * as ecs from "aws-cdk-lib/aws-ecs";
import * as iam from "aws-cdk-lib/aws-iam";
import { COLLECTOR_REGION } from "@llm-usage-lens/shared";

import type { AppInputs } from "./inputs";

// Source: docs/specs/2026-11-10-platform.md — "Created resources" (DashboardServiceStack).

export type CiDeployRoleProps = {
  inputs: AppInputs;
  service: ecs.FargateService;
  repository: ecr.IRepository;
};

// The role the GitHub Actions deploy workflow assumes through OIDC: push the
// image, update the service and deploy this stack only.
export function addCiDeployRole(stack: Stack, props: CiDeployRoleProps): void {
  const { inputs, service, repository } = props;
  const provider = `arn:${stack.partition}:iam::${inputs.account}:oidc-provider/token.actions.githubusercontent.com`;
  const role = new iam.Role(stack, "CiDeployRole", {
    assumedBy: new iam.WebIdentityPrincipal(provider, {
      StringEquals: {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        // The deploy job runs in the GitHub environment named after the
        // deploy env, so a branch or PR workflow cannot assume the role.
        "token.actions.githubusercontent.com:sub": `repo:${inputs.githubRepository}:environment:${inputs.env}`,
      },
    }),
    maxSessionDuration: Duration.hours(1),
  });
  role.addToPolicy(
    new iam.PolicyStatement({
      actions: ["ecr:GetAuthorizationToken"],
      resources: ["*"],
    }),
  );
  role.addToPolicy(
    new iam.PolicyStatement({
      actions: [
        "ecr:BatchCheckLayerAvailability",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload",
        "ecr:PutImage",
      ],
      resources: [repository.repositoryArn],
    }),
  );
  role.addToPolicy(
    new iam.PolicyStatement({
      actions: ["ecs:UpdateService", "ecs:DescribeServices"],
      resources: [service.serviceArn],
    }),
  );
  role.addToPolicy(
    new iam.PolicyStatement({
      actions: [
        "cloudformation:CreateChangeSet",
        "cloudformation:DescribeChangeSet",
        "cloudformation:ExecuteChangeSet",
        "cloudformation:DeleteChangeSet",
        "cloudformation:DescribeStacks",
        "cloudformation:DescribeStackEvents",
        "cloudformation:GetTemplate",
      ],
      resources: [stack.stackId],
    }),
  );
  role.addToPolicy(
    new iam.PolicyStatement({
      actions: ["sts:AssumeRole"],
      resources: ["deploy", "file-publishing", "image-publishing"].map(
        (kind) =>
          `arn:${stack.partition}:iam::${inputs.account}:role/cdk-hnb659fds-${kind}-role-${inputs.account}-${COLLECTOR_REGION}`,
      ),
    }),
  );
}
