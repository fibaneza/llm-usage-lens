import { request } from "node:https";
import { URL } from "node:url";

import {
  BedrockClient,
  DeleteModelInvocationLoggingConfigurationCommand,
  PutModelInvocationLoggingConfigurationCommand,
} from "@aws-sdk/client-bedrock";
import type {
  CloudFormationCustomResourceEvent,
  CloudFormationCustomResourceResponse,
  Context,
} from "aws-lambda";

type Status = "SUCCESS" | "FAILED";

const PHYSICAL_ID = "bedrock-simulator-invocation-logging-config";

const sendResponse = (
  event: CloudFormationCustomResourceEvent,
  status: Status,
  reason: string,
): Promise<void> => {
  const body: CloudFormationCustomResourceResponse = {
    Status: status,
    Reason: reason,
    PhysicalResourceId: PHYSICAL_ID,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
  } as CloudFormationCustomResourceResponse;

  const payload = JSON.stringify(body);
  const parsed = new URL(event.ResponseURL);

  return new Promise<void>((resolve, reject) => {
    const req = request(
      {
        hostname: parsed.hostname,
        port: parsed.port === "" ? 443 : Number(parsed.port),
        path: `${parsed.pathname}${parsed.search}`,
        method: "PUT",
        headers: {
          "content-type": "",
          "content-length": Buffer.byteLength(payload).toString(),
        },
      },
      (res) => {
        res.resume();
        res.on("end", () => {
          const statusCode = res.statusCode ?? 0;
          if (statusCode >= 200 && statusCode < 300) {
            resolve();
            return;
          }
          reject(
            new Error(
              `CloudFormation response endpoint returned HTTP ${statusCode}`,
            ),
          );
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
};

const readEnv = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(
      `Missing required environment variable ${name}. Set in template.yaml.`,
    );
  }
  return value;
};

const isResourceNotFound = (err: unknown): boolean => {
  if (typeof err === "object" && err !== null) {
    const name = (err as { name?: unknown }).name;
    if (typeof name === "string" && name === "ResourceNotFoundException") {
      return true;
    }
  }
  return false;
};

const applyConfiguration = async (
  client: BedrockClient,
  bucketName: string,
  logGroupName: string,
  loggingRoleArn: string,
): Promise<void> => {
  await client.send(
    new PutModelInvocationLoggingConfigurationCommand({
      loggingConfig: {
        s3Config: { bucketName },
        cloudWatchConfig: {
          logGroupName,
          roleArn: loggingRoleArn,
        },
        textDataDeliveryEnabled: true,
        imageDataDeliveryEnabled: false,
        embeddingDataDeliveryEnabled: false,
        videoDataDeliveryEnabled: false,
        audioDataDeliveryEnabled: false,
      },
    }),
  );
};

const removeConfiguration = async (client: BedrockClient): Promise<void> => {
  try {
    await client.send(new DeleteModelInvocationLoggingConfigurationCommand({}));
  } catch (err: unknown) {
    if (isResourceNotFound(err)) {
      return;
    }
    throw err;
  }
};

export const handler = async (
  event: CloudFormationCustomResourceEvent,
  _context: Context,
): Promise<void> => {
  try {
    const region = process.env["AWS_REGION"] ?? "us-east-1";
    const client = new BedrockClient({ region });

    if (event.RequestType === "Create" || event.RequestType === "Update") {
      const bucketName = readEnv("BUCKET_NAME");
      const logGroupName = readEnv("LOG_GROUP_NAME");
      const loggingRoleArn = readEnv("LOGGING_ROLE_ARN");
      await applyConfiguration(
        client,
        bucketName,
        logGroupName,
        loggingRoleArn,
      );
      await sendResponse(
        event,
        "SUCCESS",
        "Model invocation logging configured.",
      );
      return;
    }

    if (event.RequestType === "Delete") {
      await removeConfiguration(client);
      await sendResponse(
        event,
        "SUCCESS",
        "Model invocation logging removed (or already absent).",
      );
      return;
    }

    await sendResponse(
      event,
      "FAILED",
      `Unsupported RequestType received from CloudFormation.`,
    );
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    try {
      await sendResponse(event, "FAILED", reason);
    } catch {
      // Surface the original failure via Lambda logs if the response PUT
      // itself fails — CloudFormation will time out and roll back, which is
      // the correct outcome.
      throw err;
    }
  }
};
