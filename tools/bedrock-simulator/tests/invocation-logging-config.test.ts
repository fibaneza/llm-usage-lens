import { EventEmitter } from "node:events";

import type {
  CloudFormationCustomResourceEvent,
  Context,
} from "aws-lambda";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type CapturedRequest = {
  options: {
    hostname: string;
    port: number;
    path: string;
    method: string;
    headers: Record<string, string>;
  };
  body: string;
};

// Module-level holder for what the most recent request "wrote".
const captured: { last: CapturedRequest | null } = { last: null };

// Module-level holders for what the BedrockClient mock saw.
const bedrockCalls: { sent: Array<{ name: string; input: unknown }> } = {
  sent: [],
};
let bedrockSendImpl: (cmd: { name: string }) => Promise<unknown> = async () =>
  ({});

vi.mock("node:https", () => {
  return {
    request: (opts: CapturedRequest["options"], cb: (res: EventEmitter & {
      statusCode?: number;
      resume: () => void;
    }) => void) => {
      const writes: string[] = [];
      const reqEmitter = new EventEmitter() as EventEmitter & {
        write: (chunk: string) => void;
        end: () => void;
      };
      reqEmitter.write = (chunk: string): void => {
        writes.push(chunk);
      };
      reqEmitter.end = (): void => {
        captured.last = {
          options: opts,
          body: writes.join(""),
        };
        // Simulate a 200 response from the S3 pre-signed URL.
        const res = new EventEmitter() as EventEmitter & {
          statusCode?: number;
          resume: () => void;
        };
        res.statusCode = 200;
        res.resume = (): void => {
          /* noop */
        };
        // Fire the callback then end the response stream asynchronously.
        cb(res);
        setImmediate(() => res.emit("end"));
      };
      return reqEmitter;
    },
  };
});

vi.mock("@aws-sdk/client-bedrock", () => {
  class FakeBedrockClient {
    send = async (cmd: { constructor: { name: string }; input: unknown }) => {
      const name = cmd.constructor.name;
      bedrockCalls.sent.push({ name, input: cmd.input });
      return bedrockSendImpl({ name });
    };
  }
  class PutModelInvocationLoggingConfigurationCommand {
    public input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class DeleteModelInvocationLoggingConfigurationCommand {
    public input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  return {
    BedrockClient: FakeBedrockClient,
    PutModelInvocationLoggingConfigurationCommand,
    DeleteModelInvocationLoggingConfigurationCommand,
  };
});

const ENV_VARS = [
  "BUCKET_NAME",
  "LOG_GROUP_NAME",
  "LOGGING_ROLE_ARN",
  "AWS_REGION",
] as const;

const snapshot = (): Record<string, string | undefined> => {
  const out: Record<string, string | undefined> = {};
  for (const k of ENV_VARS) out[k] = process.env[k];
  return out;
};
const restore = (snap: Record<string, string | undefined>): void => {
  for (const k of ENV_VARS) {
    const prior = snap[k];
    if (prior === undefined) delete process.env[k];
    else process.env[k] = prior;
  }
};

const baseEvent = (
  type: "Create" | "Update" | "Delete",
): CloudFormationCustomResourceEvent =>
  ({
    RequestType: type,
    ServiceToken: "arn:aws:lambda:us-east-1:1:function:custom",
    ResponseURL:
      "https://cloudformation-custom-resource-response-useast1.s3.amazonaws.com/test-presigned-url?token=abc",
    StackId:
      "arn:aws:cloudformation:us-east-1:1:stack/bedrock-simulator/abc",
    RequestId: "req-1",
    LogicalResourceId: "BedrockInvocationLoggingConfig",
    ResourceType: "Custom::BedrockInvocationLogging",
    ResourceProperties: { ServiceToken: "x" },
    ...(type === "Update"
      ? { PhysicalResourceId: "physical-id", OldResourceProperties: {} }
      : type === "Delete"
        ? { PhysicalResourceId: "physical-id" }
        : {}),
  }) as unknown as CloudFormationCustomResourceEvent;

const fakeContext = (): Context =>
  ({
    awsRequestId: "ctx-1",
    functionName: "fn",
    invokedFunctionArn: "arn",
    getRemainingTimeInMillis: () => 60_000,
  }) as unknown as Context;

describe("invocation-logging-config handler", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = snapshot();
    process.env["BUCKET_NAME"] = "sim-bucket";
    process.env["LOG_GROUP_NAME"] = "/aws/bedrock/sim";
    process.env["LOGGING_ROLE_ARN"] =
      "arn:aws:iam::111111111111:role/BedrockLoggingRole";
    process.env["AWS_REGION"] = "us-east-1";
    captured.last = null;
    bedrockCalls.sent = [];
    bedrockSendImpl = async () => ({});
  });

  afterEach(() => {
    restore(saved);
    vi.clearAllMocks();
  });

  it("Create calls PutModelInvocationLoggingConfiguration with the env-var values and PUTs SUCCESS to event.ResponseURL", async () => {
    const { handler } = await import("../src/invocation-logging-config.js");
    await handler(baseEvent("Create"), fakeContext());

    expect(bedrockCalls.sent).toHaveLength(1);
    const sent = bedrockCalls.sent[0];
    expect(sent?.name).toBe("PutModelInvocationLoggingConfigurationCommand");
    const input = sent?.input as {
      loggingConfig?: {
        s3Config?: { bucketName?: string };
        cloudWatchConfig?: { logGroupName?: string; roleArn?: string };
        textDataDeliveryEnabled?: boolean;
        imageDataDeliveryEnabled?: boolean;
      };
    };
    expect(input.loggingConfig?.s3Config?.bucketName).toBe("sim-bucket");
    expect(input.loggingConfig?.cloudWatchConfig?.logGroupName).toBe(
      "/aws/bedrock/sim",
    );
    expect(input.loggingConfig?.cloudWatchConfig?.roleArn).toBe(
      "arn:aws:iam::111111111111:role/BedrockLoggingRole",
    );
    expect(input.loggingConfig?.textDataDeliveryEnabled).toBe(true);
    expect(input.loggingConfig?.imageDataDeliveryEnabled).toBe(false);

    expect(captured.last).not.toBeNull();
    expect(captured.last?.options.method).toBe("PUT");
    expect(captured.last?.options.hostname).toBe(
      "cloudformation-custom-resource-response-useast1.s3.amazonaws.com",
    );
    expect(captured.last?.options.path).toContain("/test-presigned-url");
    const body = JSON.parse(captured.last?.body ?? "{}") as {
      Status: string;
      StackId: string;
      RequestId: string;
      LogicalResourceId: string;
      PhysicalResourceId: string;
    };
    expect(body.Status).toBe("SUCCESS");
    expect(body.StackId).toBe(
      "arn:aws:cloudformation:us-east-1:1:stack/bedrock-simulator/abc",
    );
    expect(body.RequestId).toBe("req-1");
    expect(body.LogicalResourceId).toBe("BedrockInvocationLoggingConfig");
    expect(body.PhysicalResourceId).toBeTypeOf("string");
  });

  it("Update calls PutModelInvocationLoggingConfiguration (same path as Create)", async () => {
    const { handler } = await import("../src/invocation-logging-config.js");
    await handler(baseEvent("Update"), fakeContext());
    expect(bedrockCalls.sent[0]?.name).toBe(
      "PutModelInvocationLoggingConfigurationCommand",
    );
    const body = JSON.parse(captured.last?.body ?? "{}") as { Status: string };
    expect(body.Status).toBe("SUCCESS");
  });

  it("Delete calls DeleteModelInvocationLoggingConfiguration and reports SUCCESS", async () => {
    const { handler } = await import("../src/invocation-logging-config.js");
    await handler(baseEvent("Delete"), fakeContext());
    expect(bedrockCalls.sent[0]?.name).toBe(
      "DeleteModelInvocationLoggingConfigurationCommand",
    );
    const body = JSON.parse(captured.last?.body ?? "{}") as { Status: string };
    expect(body.Status).toBe("SUCCESS");
  });

  it("Delete swallows ResourceNotFoundException and still reports SUCCESS", async () => {
    bedrockSendImpl = async () => {
      throw Object.assign(new Error("not found"), {
        name: "ResourceNotFoundException",
      });
    };
    const { handler } = await import("../src/invocation-logging-config.js");
    await handler(baseEvent("Delete"), fakeContext());
    const body = JSON.parse(captured.last?.body ?? "{}") as { Status: string };
    expect(body.Status).toBe("SUCCESS");
  });

  it("Delete propagates non-ResourceNotFound errors as FAILED", async () => {
    bedrockSendImpl = async () => {
      throw Object.assign(new Error("kaboom"), { name: "InternalServerError" });
    };
    const { handler } = await import("../src/invocation-logging-config.js");
    await handler(baseEvent("Delete"), fakeContext());
    const body = JSON.parse(captured.last?.body ?? "{}") as {
      Status: string;
      Reason: string;
    };
    expect(body.Status).toBe("FAILED");
    expect(body.Reason).toContain("kaboom");
  });

  it("Create reports FAILED to CFN when a required env var is missing", async () => {
    delete process.env["BUCKET_NAME"];
    const { handler } = await import("../src/invocation-logging-config.js");
    await handler(baseEvent("Create"), fakeContext());
    expect(bedrockCalls.sent).toHaveLength(0);
    const body = JSON.parse(captured.last?.body ?? "{}") as {
      Status: string;
      Reason: string;
    };
    expect(body.Status).toBe("FAILED");
    expect(body.Reason).toMatch(/BUCKET_NAME/);
  });

  // The CFN response endpoint is a pre-signed S3 URL. AWS docs require the
  // content-type header on the PUT to be EMPTY (not application/json), and a
  // content-length matching the body size — otherwise S3 rejects the upload
  // and CloudFormation hangs until timeout.
  it("PUTs the CFN response with an empty content-type and matching content-length", async () => {
    const { handler } = await import("../src/invocation-logging-config.js");
    await handler(baseEvent("Create"), fakeContext());
    expect(captured.last).not.toBeNull();
    expect(captured.last?.options.headers["content-type"]).toBe("");
    const declared = Number(
      captured.last?.options.headers["content-length"] ?? "0",
    );
    expect(declared).toBe(Buffer.byteLength(captured.last?.body ?? ""));
  });

  // Spec — invocation-logging payload bookkeeping: text payloads are on,
  // image/audio/video/embedding are off (text-only test harness).
  it("Create enables text data and disables image/embedding/video/audio data", async () => {
    const { handler } = await import("../src/invocation-logging-config.js");
    await handler(baseEvent("Create"), fakeContext());
    const sent = bedrockCalls.sent[0];
    const input = sent?.input as {
      loggingConfig?: {
        textDataDeliveryEnabled?: boolean;
        imageDataDeliveryEnabled?: boolean;
        embeddingDataDeliveryEnabled?: boolean;
        videoDataDeliveryEnabled?: boolean;
        audioDataDeliveryEnabled?: boolean;
      };
    };
    expect(input.loggingConfig?.textDataDeliveryEnabled).toBe(true);
    expect(input.loggingConfig?.imageDataDeliveryEnabled).toBe(false);
    expect(input.loggingConfig?.embeddingDataDeliveryEnabled).toBe(false);
    expect(input.loggingConfig?.videoDataDeliveryEnabled).toBe(false);
    expect(input.loggingConfig?.audioDataDeliveryEnabled).toBe(false);
  });
});
