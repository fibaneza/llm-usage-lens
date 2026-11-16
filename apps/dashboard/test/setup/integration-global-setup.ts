// Deletes the per-run integration table (named in vitest.config.ts) once the
// run ends, so DynamoDB Local does not accumulate one table per run.
import {
  DeleteTableCommand,
  DynamoDBClient,
  ResourceNotFoundException,
} from "@aws-sdk/client-dynamodb";
import type { TestProject } from "vitest/node";

export function setup(project: TestProject): () => Promise<void> {
  const env = project.config.env;
  return () => deleteTable(env);
}

async function deleteTable(
  env: Record<string, string | undefined>,
): Promise<void> {
  const tableName = env.DYNAMODB_TABLE_NAME;
  if (!tableName?.startsWith("bedrock-usage-test-")) return;
  const client = new DynamoDBClient({
    endpoint: env.DYNAMODB_ENDPOINT,
    region: env.AWS_REGION,
    credentials: { accessKeyId: "local", secretAccessKey: "local" },
  });
  try {
    await client.send(new DeleteTableCommand({ TableName: tableName }));
  } catch (error) {
    // No integration test created the table in this run.
    if (!(error instanceof ResourceNotFoundException)) throw error;
  } finally {
    client.destroy();
  }
}
