// Deletes this run's integration tables (`bedrock-usage-test-<pid>-<slot>-<suffix>`,
// one per test file; see integration-file-table.ts) once the run ends, so
// DynamoDB Local does not accumulate tables.
import {
  DeleteTableCommand,
  DynamoDBClient,
  ListTablesCommand,
  ResourceNotFoundException,
} from "@aws-sdk/client-dynamodb";
import type { TestProject } from "vitest/node";

import { isLocalEndpoint } from "../../../../scripts/lib/dynamodb-local";

const TEST_TABLE_PREFIX = "bedrock-usage-test-";
const DELETE_CONCURRENCY = 8;

export function setup(project: TestProject): () => Promise<void> {
  const env = project.config.env;
  return () => deleteRunTables(env);
}

async function deleteRunTables(
  env: Record<string, string | undefined>,
): Promise<void> {
  const base = env.INTEGRATION_TABLE_BASE;
  if (!base?.startsWith(TEST_TABLE_PREFIX)) return;
  if (!env.DYNAMODB_ENDPOINT || !isLocalEndpoint(env.DYNAMODB_ENDPOINT)) {
    throw new Error(
      `Refusing to delete tables on non-local DYNAMODB_ENDPOINT "${env.DYNAMODB_ENDPOINT}"`,
    );
  }
  // Trailing dash: never matches another pid that shares this pid's digits.
  const runPrefix = `${base}-`;
  const client = new DynamoDBClient({
    endpoint: env.DYNAMODB_ENDPOINT,
    region: env.AWS_REGION,
    credentials: { accessKeyId: "local", secretAccessKey: "local" },
  });
  try {
    let startName: string | undefined;
    do {
      const page = await client.send(
        new ListTablesCommand({ ExclusiveStartTableName: startName }),
      );
      const names = (page.TableNames ?? []).filter(
        (name) =>
          name.startsWith(TEST_TABLE_PREFIX) && name.startsWith(runPrefix),
      );
      for (let i = 0; i < names.length; i += DELETE_CONCURRENCY) {
        await Promise.all(
          names.slice(i, i + DELETE_CONCURRENCY).map(async (name) => {
            try {
              await client.send(new DeleteTableCommand({ TableName: name }));
            } catch (error) {
              if (!(error instanceof ResourceNotFoundException)) throw error;
            }
          }),
        );
      }
      startName = page.LastEvaluatedTableName;
    } while (startName);
  } finally {
    client.destroy();
  }
}
